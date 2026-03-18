"""
ReAct agent runner with full instrumentation.

Runs an LLM agent against a coding task using the tool-calling API.
Every tool call, its timing, doc lookups, and interruptions are recorded
in a RunRecord for downstream scoring and report generation.
"""

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from config.costs import estimate_cost
from config.settings import BASE_URL, BEDROCK_MODELS, GEMINI_MODELS, MAX_TURNS


def is_bedrock_model(model: str) -> bool:
    """Check if model is routed through Bedrock and requires special handling."""
    return any(bedrock in model for bedrock in BEDROCK_MODELS)


def is_gemini_model(model: str) -> bool:
    """Check if model uses the functions/function_call API (Gemini via proxy)."""
    return any(model.startswith(prefix) for prefix in GEMINI_MODELS)


# ── Data model ───────────────────────────────────────────────────────────────

@dataclass
class ToolCallRecord:
    name: str
    args: dict
    result: str
    start_time: float
    end_time: float
    is_doc_lookup: bool = False
    is_interruption: bool = False
    caused_error: bool = False

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time


@dataclass
class RunRecord:
    task_name: str
    model: str
    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    start_time: float = 0.0
    end_time: float = 0.0
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    provider_errors: list[str] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    status: str = "running"   # running | success | failure
    final_summary: str = ""
    workspace: str = ""

    @property
    def wall_time(self) -> float:
        return max(0.0, self.end_time - self.start_time)

    @property
    def active_time(self) -> float:
        """Sum of all tool-call durations (approximates real work time)."""
        return sum(tc.duration for tc in self.tool_calls)

    @property
    def interruption_count(self) -> int:
        return sum(1 for tc in self.tool_calls if tc.is_interruption)

    @property
    def doc_lookup_count(self) -> int:
        return sum(1 for tc in self.tool_calls if tc.is_doc_lookup)

    @property
    def tool_call_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for tc in self.tool_calls:
            counts[tc.name] = counts.get(tc.name, 0) + 1
        return counts

    def tool_call_summary(self) -> str:
        """e.g. 'Read×7 Bash×3 Write×2'"""
        label_map = {
            "read_file": "Read",
            "write_file": "Write",
            "run_command": "Bash",
            "fetch_url": "Fetch",
            "ask_user": "Ask",
        }
        parts = []
        for name, count in self.tool_call_counts.items():
            label = label_map.get(name, name)
            parts.append(f"{label}×{count}")
        return " ".join(parts)


# ── Tool definitions sent to the LLM ─────────────────────────────────────────

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file in the project workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path within the workspace"}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or overwrite a file in the project workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a shell command inside the project workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"}
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch the contents of a documentation URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": (
                "Ask the user for information you cannot determine yourself "
                "(e.g. credentials, tenant domain, client IDs, dashboard URLs). "
                "Only use this when you truly cannot proceed without human input."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"}
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish_task",
            "description": (
                "Signal that the task is complete. Call this when all required "
                "files have been written and no further changes are needed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Brief summary of what was done"}
                },
                "required": ["summary"],
            },
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────

class ToolExecutor:
    def __init__(self, workspace: str, credentials: Optional[dict] = None):
        self.workspace = Path(workspace)
        self.credentials = credentials or {}

    def execute(self, name: str, args: dict) -> tuple[str, bool, bool, bool]:
        """
        Returns (result, is_doc_lookup, is_interruption, caused_error).
        """
        args = _normalize_tool_args(name, args)

        try:
            if name == "read_file":
                return self._read_file(args["path"]), False, False, False
            elif name == "write_file":
                return self._write_file(args["path"], args["content"]), False, False, False
            elif name == "run_command":
                return self._run_command(args["command"]), False, False, False
            elif name == "fetch_url":
                return self._fetch_url(args["url"]), True, False, False
            elif name == "ask_user":
                return self._ask_user(args["question"]), False, True, False
            elif name == "finish_task":
                return args.get("summary", "Task complete."), False, False, False
            else:
                return f"Unknown tool: {name}", False, False, True
        except Exception as e:
            return f"Error executing {name}: {e}", False, False, True

    def _read_file(self, path: str) -> str:
        full = self.workspace / path
        if not full.exists():
            # Try listing directory to help orient the agent
            parent = full.parent
            if parent.exists():
                files = [str(f.relative_to(self.workspace)) for f in parent.iterdir()]
                return f"File not found: {path}\nFiles in {parent.name}/: {files}"
            return f"File not found: {path}"
        return full.read_text(errors="replace")

    def _write_file(self, path: str, content: str) -> str:
        full = self.workspace / path
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content)
        return f"Written: {path} ({len(content)} chars)"

    def _run_command(self, command: str) -> str:
        result = subprocess.run(
            command,
            shell=True,
            cwd=self.workspace,
            capture_output=True,
            text=True,
            timeout=60,
        )
        out = result.stdout[-2000:] if result.stdout else ""
        err = result.stderr[-1000:] if result.stderr else ""
        combined = (out + ("\n" + err if err else "")).strip()
        return combined or "(no output)"

    def _fetch_url(self, url: str) -> str:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "auth0-eval-agent/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read(8000).decode("utf-8", errors="replace")
            # Strip HTML tags for readability
            import re
            text = re.sub(r"<[^>]+>", " ", raw)
            text = re.sub(r"\s{3,}", "\n", text)
            return text[:3000].strip()
        except Exception as e:
            return f"Could not fetch {url}: {e}"

    def _ask_user(self, question: str) -> str:
        # Check if credentials are pre-populated to avoid interruption
        lower_q = question.lower()
        if any(k in lower_q for k in ["domain", "tenant"]) and "domain" in self.credentials:
            return self.credentials["domain"]
        if any(k in lower_q for k in ["client id", "clientid", "client_id"]) and "client_id" in self.credentials:
            return self.credentials["client_id"]
        # Must actually ask the user
        print(f"\n[AGENT ASKING]: {question}")
        answer = input("Your answer: ").strip()
        return answer or "(no answer provided)"


# ── LLM client ───────────────────────────────────────────────────────────────

def llm_call(
    api_key: str,
    model: str,
    messages: list[dict],
    tools: list[dict],
) -> dict:
    # Calculate approximate input size for logging
    input_text = json.dumps(messages)
    input_size_kb = len(input_text.encode('utf-8')) / 1024

    print(f"\n[LLM API] Calling remote API: {BASE_URL}/chat/completions")
    print(f"[LLM API] Model: {model}")
    print(f"[LLM API] Messages: {len(messages)} in history (~{input_size_kb:.1f} KB)")
    print(f"[LLM API] Waiting for response...")

    call_start = time.time()

    # Bedrock models do not support toolConfig — omit tools entirely and rely
    # on XML tool-call parsing from the response content instead.
    if is_bedrock_model(model):
        body: dict = {"model": model, "messages": messages, "temperature": 0.0}
    elif is_gemini_model(model):
        # Gemini via proxy uses the older functions/function_call API.
        functions = [t["function"] for t in tools]
        body = {
            "model": model,
            "messages": messages,
            "functions": functions,
            "function_call": "auto",
            "temperature": 0.0,
        }
    else:
        body = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "required",
            "temperature": 0.0,
        }

    payload = json.dumps(body).encode()

    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            response_data = json.loads(resp.read())

        call_duration = time.time() - call_start
        usage = response_data.get("usage", {})

        input_tokens, output_tokens = _extract_tokens(usage)

        print(f"[LLM API] Response received ({call_duration:.2f}s)")
        print(f"[LLM API] Tokens: {input_tokens} in / {output_tokens} out")
        
        # Check if response has tool calls or is final message
        message = response_data.get("choices", [{}])[0].get("message", {})
        tool_calls = message.get("tool_calls")
        function_call = message.get("function_call")
        if tool_calls:
            print(f"[LLM API] Agent requested {len(tool_calls)} tool call(s)")
        elif function_call:
            print(f"[LLM API] Agent requested function call: {function_call.get('name')}")
        else:
            content_preview = (message.get("content") or "")[:80]
            print(f"[LLM API] Agent finished: \"{content_preview}\"")
        
        return response_data
    except urllib.error.HTTPError as e:
        call_duration = time.time() - call_start
        body = e.read().decode()
        print(f"[LLM API] ❌ API error {e.code} after {call_duration:.2f}s")
        print(f"[LLM API] 💥 Error: {body[:200]}")
        
        # Detect Bedrock toolConfig error and provide helpful message
        if "toolConfig" in body and "BedrockException" in body:
            raise RuntimeError(
                f"Bedrock model '{model}' requires special handling. "
                f"Ensure it is listed in BEDROCK_MODELS in config/settings.py."
            ) from e
        
        raise RuntimeError(f"LLM API error {e.code}: {body[:400]}") from e


# ── Agent runner ──────────────────────────────────────────────────────────────

def run_agent(
    api_key: str,
    model: str,
    task: "TaskDefinition",  # noqa: F821
    workspace: str,
    credentials: Optional[dict] = None,
) -> RunRecord:
    """
    Run the agent against a task. Returns a fully populated RunRecord.
    Includes validation for Bedrock models that don't support tool calling.
    """
    # Bedrock models use XML tool calling — log that we're in fallback mode
    if is_bedrock_model(model):
        print(f"\n[Agent] Model '{model}' is Bedrock-routed — using XML tool-call fallback mode")
    elif is_gemini_model(model):
        print(f"\n[Agent] Model '{model}' is Gemini — using functions/function_call API")
    
    record = RunRecord(task_name=task.name, model=model, workspace=workspace)
    executor = ToolExecutor(workspace, credentials)

    messages: list[dict] = []
    if task.agent_system_prompt:
        messages.append({"role": "system", "content": task.agent_system_prompt})
    messages.append({"role": "user", "content": task.user_prompt})

    record.start_time = time.time()
    print(f"\n[Agent] Starting task: {task.name}")
    print(f"[Agent] Model: {model} | Workspace: {workspace}\n")

    for turn in range(MAX_TURNS):
        response = llm_call(api_key, model, messages, TOOL_DEFINITIONS)

        # Accumulate token usage
        usage = response.get("usage", {})
        turn_input, turn_output = _extract_tokens(usage)
        record.input_tokens  += turn_input
        record.output_tokens += turn_output

        choice = response["choices"][0]
        message = choice["message"]
        finish_reason = choice.get("finish_reason", "")

        # Append assistant message to history
        messages.append(message)

        tool_calls = message.get("tool_calls") or []

        # Gemini via proxy returns a single function_call object instead of
        # a tool_calls list — normalise it into the standard format.
        if not tool_calls and message.get("function_call"):
            fc = message["function_call"]
            tool_calls = [{
                "id": "fc_0",
                "type": "function",
                "function": {
                    "name": fc["name"],
                    "arguments": fc.get("arguments", "{}"),
                },
            }]

        # Fallback: some models (e.g. claude-4-6-opus via Bedrock) embed tool
        # calls as <tool_call>{"name":...}</tool_call> in the content field
        # instead of using the standard tool_calls API field.
        if not tool_calls:
            tool_calls = _parse_xml_tool_calls(message.get("content") or "")
            if tool_calls and not is_bedrock_model(model):
                # For non-Bedrock models inject into message so the loop can
                # use the standard tool execution path.
                message["tool_calls"] = tool_calls
                content = message.get("content") or ""
                clean = content[:content.find("<tool_call>")].strip() if "<tool_call>" in content else content
                message["content"] = clean or None
            # For Bedrock models we keep tool_calls local only — mutating the
            # message would cause LiteLLM to trigger Bedrock tool_use handling.

        if not tool_calls:
            record.final_summary = message.get("content") or ""
            record.status = "success"
            print(f"\n[Agent] Done. Final message: {record.final_summary[:200]}")
            break

        # Execute each tool call
        task_finished = False
        for tc in tool_calls:
            fn = tc["function"]
            tool_name = fn["name"]
            try:
                tool_args = json.loads(fn["arguments"])
            except json.JSONDecodeError:
                tool_args = {}

            tool_args = _normalize_tool_args(tool_name, tool_args)

            print(f"  [{turn+1}] {tool_name}({_summarise_args(tool_name, tool_args)})")

            t_start = time.time()
            result, is_doc, is_interrupt, is_error = executor.execute(tool_name, tool_args)
            t_end = time.time()

            if is_error:
                record.provider_errors.append(f"{tool_name}: {result}")

            record.tool_calls.append(ToolCallRecord(
                name=tool_name,
                args=tool_args,
                result=result,
                start_time=t_start,
                end_time=t_end,
                is_doc_lookup=is_doc,
                is_interruption=is_interrupt,
                caused_error=is_error,
            ))

            # Bedrock models don't support role=tool — return results inline
            # as a user message. Avoid <tool_result> tags since LiteLLM
            # intercepts them and requires tools= to be present.
            # Gemini via proxy uses role=function with the function name.
            if is_bedrock_model(model):
                messages.append({
                    "role": "user",
                    "content": f"[Result of {tool_name}]:\n{result}",
                })
            elif is_gemini_model(model):
                messages.append({
                    "role": "function",
                    "name": tool_name,
                    "content": result,
                })
            else:
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            if tool_name == "finish_task":
                record.final_summary = tool_args.get("summary", result)
                record.status = "success"
                task_finished = True
                print(f"\n[Agent] Done. Summary: {record.final_summary[:200]}")

        if task_finished:
            break

    else:
        record.status = "failure"
        print("[Agent] Max turns reached without completion.")

    record.end_time = time.time()
    record.cost_usd = estimate_cost(model, record.input_tokens, record.output_tokens)
    return record


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_tokens(usage: dict) -> tuple[int, int]:
    """Extract input and output token counts from an API usage dict.

    Handles both naming conventions:
      - OpenAI-style:  prompt_tokens / completion_tokens
      - Anthropic-style: input_tokens / output_tokens
    """
    input_tokens  = usage.get("prompt_tokens")
    if input_tokens is None:
        input_tokens  = usage.get("input_tokens",  0)
    output_tokens = usage.get("completion_tokens")
    if output_tokens is None:
        output_tokens = usage.get("output_tokens", 0)
    return input_tokens, output_tokens


def _normalize_tool_args(name: str, args: dict) -> dict:
    """Normalize tool arguments, handling common parameter name variations.

    Different LLM providers use different parameter names for the same
    conceptual argument, e.g. gpt-4-turbo sends {"filename": ...} instead
    of {"path": ...}.  This function converts known aliases to the canonical
    key so the rest of the code only needs to handle one name per tool.
    """
    if name in ("read_file", "write_file") and "path" not in args:
        for alias in ("filename", "file_path", "filepath", "file"):
            if alias in args:
                return {**args, "path": args[alias]}
    if name == "run_command" and "command" not in args:
        for alias in ("cmd", "shell_command", "bash_command"):
            if alias in args:
                return {**args, "command": args[alias]}
    return args


def _parse_xml_tool_calls(content: str) -> list[dict]:
    """
    Extract tool calls from models that embed them as XML in the content field
    instead of using the standard tool_calls API field, e.g.:

        <tool_call>
        {"name": "read_file", "arguments": {"path": "foo.swift"}}
        </tool_call>

    Only extracts calls that appear before the first <tool_result> block so
    that hallucinated results from the same response are ignored.
    """
    import re

    # Truncate at the first <tool_result> — everything after is hallucinated
    cutoff = content.find("<tool_result>")
    text = content[:cutoff] if cutoff != -1 else content

    pattern = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)
    tool_calls = []
    for i, match in enumerate(pattern.finditer(text)):
        try:
            body = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        tool_calls.append({
            "id": f"xml_call_{i}",
            "type": "function",
            "function": {
                "name": body.get("name", ""),
                "arguments": json.dumps(body.get("arguments", {})),
            },
        })
    return tool_calls


def _summarise_args(tool_name: str, args: dict) -> str:
    if tool_name in ("read_file", "write_file"):
        path = args.get("path", "")
        suffix = f", {len(args.get('content',''))} chars" if "content" in args else ""
        return f'"{path}"{suffix}'
    if tool_name == "run_command":
        cmd = args.get("command", "")
        return f'"{cmd[:60]}"'
    if tool_name == "fetch_url":
        return f'"{args.get("url","")[:60]}"'
    if tool_name == "ask_user":
        return f'"{args.get("question","")[:60]}"'
    if tool_name == "finish_task":
        return f'"{args.get("summary","")[:60]}"'
    return str(args)[:80]


def setup_workspace(scaffold: dict[str, str]) -> str:
    """Copy scaffold files into a fresh temp directory and return its path."""
    workspace = tempfile.mkdtemp(prefix="auth0_eval_")
    for rel_path, content in scaffold.items():
        dest = Path(workspace) / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content)
    return workspace


def cleanup_workspace(workspace: str) -> None:
    shutil.rmtree(workspace, ignore_errors=True)
