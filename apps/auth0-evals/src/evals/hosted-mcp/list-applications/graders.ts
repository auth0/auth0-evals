import { calledTool, GraderLevel } from '@a0/eval-graders';

export function defineGraders() {
  return [
    // L4: agent actually invoked the right MCP tool (trace-based).
    // No holistic judge: this task produces no file artifact, and the judge only
    // sees workspace files — see docs/superpowers/specs/2026-06-05-hosted-mcp-eval-design.md.
    calledTool('auth0_list_applications', 'Called the auth0_list_applications MCP tool', GraderLevel.L4),
  ];
}
