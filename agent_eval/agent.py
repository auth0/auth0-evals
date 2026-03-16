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

BASE_URL = "https://llm.atko.ai/v1"

# Models known to have toolConfig issues with Bedrock
BEDROCK_INCOMPATIBLE_MODELS = [
    "claude-4-5-opus",
    "claude-4-5-sonnet", 
    "claude-4-5-haiku",
]


def is_bedrock_model(model: str) -> bool:
    """Check if model is a Bedrock Claude model that requires special toolConfig."""
    return any(bedrock in model for bedrock in BEDROCK_INCOMPATIBLE_MODELS)
MAX_TURNS = 30


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
    
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.0,
    }).encode()

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
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        
        print(f"[LLM API] Response received ({call_duration:.2f}s)")
        print(f"[LLM API] Tokens: {prompt_tokens} in / {completion_tokens} out")
        
        # Check if response has tool calls or is final message
        message = response_data.get("choices", [{}])[0].get("message", {})
        tool_calls = message.get("tool_calls")
        if tool_calls:
            print(f"[LLM API] Agent requested {len(tool_calls)} tool call(s)")
        else:
            content_preview = (message.get("content") or "")[:80]
            print(f"[LLM API] Agent finished: \"{content_preview}...\"")
        
        return response_data
    except urllib.error.HTTPError as e:
        call_duration = time.time() - call_start
        body = e.read().decode()
        print(f"[LLM API] ❌ API error {e.code} after {call_duration:.2f}s")
        print(f"[LLM API] 💥 Error: {body[:200]}")
        
        # Detect Bedrock toolConfig error and provide helpful message
        if "toolConfig" in body and "BedrockException" in body:
            print(f"\n[LLM API] 🔍 This is a Bedrock model toolConfig error")
            print(f"[LLM API] 💡 Use Anthropic API models instead of Bedrock:")
            print(f"[LLM API]    --model claude-3-5-sonnet-20241022")
            print(f"[LLM API]    --model claude-3-5-haiku-20241022")
            raise RuntimeError(
                f"Bedrock model '{model}' requires toolConfig field which is not supported. "
                f"Use Anthropic API models (claude-3-5-sonnet-20241022, etc.) instead."
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
    # Check for incompatible Bedrock models upfront
    if is_bedrock_model(model):
        print(f"\n[Agent] ⚠️  WARNING: Model '{model}' is a Bedrock model")
        print(f"[Agent] Bedrock models require toolConfig field which is not supported")
        print(f"[Agent] This will likely fail. Use Anthropic API models instead:")
        print(f"[Agent]   - claude-3-5-sonnet-20241022")
        print(f"[Agent]   - claude-3-5-haiku-20241022")
        print(f"[Agent]   - claude-3-opus-20240229")
    
    record = RunRecord(task_name=task.name, model=model, workspace=workspace)
    executor = ToolExecutor(workspace, credentials)

    messages: list[dict] = []
    if task.system_prompt:
        messages.append({"role": "system", "content": task.system_prompt})
    messages.append({"role": "user", "content": task.user_prompt})

    record.start_time = time.time()
    print(f"\n[Agent] Starting task: {task.name}")
    print(f"[Agent] Model: {model} | Workspace: {workspace}\n")

    for turn in range(MAX_TURNS):
        response = llm_call(api_key, model, messages, TOOL_DEFINITIONS)

        # Accumulate token usage
        usage = response.get("usage", {})
        record.input_tokens += usage.get("prompt_tokens", 0)
        record.output_tokens += usage.get("completion_tokens", 0)

        choice = response["choices"][0]
        message = choice["message"]
        finish_reason = choice.get("finish_reason", "")

        # Append assistant message to history
        messages.append(message)

        tool_calls = message.get("tool_calls") or []

        if not tool_calls:
            # Agent is done
            record.final_summary = message.get("content") or ""
            record.status = "success"
            print(f"\n[Agent] Done. Final message: {record.final_summary[:200]}")
            break

        # Execute each tool call
        for tc in tool_calls:
            fn = tc["function"]
            tool_name = fn["name"]
            try:
                tool_args = json.loads(fn["arguments"])
            except json.JSONDecodeError:
                tool_args = {}

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

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })

    else:
        record.status = "failure"
        print("[Agent] Max turns reached without completion.")

    record.end_time = time.time()
    record.cost_usd = _estimate_cost(model, record.input_tokens, record.output_tokens)
    return record


# ── Helpers ───────────────────────────────────────────────────────────────────

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
    return str(args)[:80]


# TODO: prices below are approximate and have not been verified.
# Review before using cost figures for any reporting or budgeting.
_COST_TABLE = {
    "gpt-5.2":           (10.0, 30.0),
    "claude-4-6-sonnet": (3.0,  15.0),
    "claude-4-6-opus":   (15.0, 75.0),
    "gemini-3-pro-preview":  (2.0,  10.0),
}

def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    in_price, out_price = _COST_TABLE.get(model, (1.0, 5.0))
    return (input_tokens * in_price + output_tokens * out_price) / 1_000_000


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
