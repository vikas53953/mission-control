// Read-only guardrail: the ONLY commands this server may ever send to a device.
// Anything that is not a show-class read is rejected here, before any adapter
// is called. This is the code-level half of "read-only against real kit".
const READ_VERBS = ['show', 'ping', 'traceroute', 'dir', 'more'];

// Blocked outright even if they somehow appear after a read verb — pipes and
// chains are how a read command gets turned into a write.
const FORBIDDEN = /[;&|><`$\n\r]|\b(config|configure|write|erase|reload|copy|delete|clear|set|no\s|shut|reset|debug|test|install|request)\b/i;

function checkCommand(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return { allowed: false, reason: 'Empty command — nothing to run.' };

  const verb = cmd.split(/\s+/)[0].toLowerCase();
  if (!READ_VERBS.includes(verb)) {
    return {
      allowed: false,
      reason: `Blocked: "${verb}" is not a read-only command. Allowed verbs: ${READ_VERBS.join(', ')}.`,
    };
  }

  if (FORBIDDEN.test(cmd)) {
    return {
      allowed: false,
      reason: 'Blocked: command contains a chained or state-changing keyword. Read-only commands only.',
    };
  }

  return { allowed: true, command: cmd };
}

// Convenience wrapper for callers: throws with a plain-words message.
function assertReadOnly(command) {
  const verdict = checkCommand(command);
  if (!verdict.allowed) throw new Error(verdict.reason);
  return verdict.command;
}

module.exports = { checkCommand, assertReadOnly, READ_VERBS };
