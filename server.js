const express = require('express');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3000;

// Paths to watch
const SQUAD_ROOT = 'C:\\Users\\vikasmit\\network-squad';
const PATHS = {
  agentWorkspace: path.join(SQUAD_ROOT, 'agents'),
  tasksFile: path.join(SQUAD_ROOT, 'shared', 'TASKS.md'),
  activityLog: path.join(SQUAD_ROOT, 'shared', 'ACTIVITY_LOG.md'),
  alertsFile: path.join(SQUAD_ROOT, 'shared', 'ALERTS.md'),
  reportsFolder: path.join(SQUAD_ROOT, 'agents', 'netops', 'reports'),
  mentionsLog: path.join(SQUAD_ROOT, 'shared', 'MENTIONS.md')
};

// All agent IDs
const AGENT_IDS = ['jarvis', 'netops', 'sentinel', 'firewall-pro', 'loadbal-pro', 'router-expert', 'monitor-eye', 'config-keeper', 'incident-handler', 'doc-writer'];

// Helper: get status file path for any agent
function getAgentStatusPath(agentId) {
  return path.join(SQUAD_ROOT, 'agents', agentId, 'STATUS.json');
}

// Agent registry
const agents = {
  jarvis: {
    id: 'jarvis',
    name: 'Jarvis',
    icon: '🎖️',
    role: 'squad-lead',
    description: 'Squad Lead — coordinates all agents, daily standups',
    status: 'active',
    currentTask: 'Monitoring squad',
    lastUpdated: new Date().toISOString(),
    lastAction: 'Squad Lead online — monitoring initiated',
    manages: ['netops', 'sentinel', 'firewall-pro', 'loadbal-pro', 'router-expert', 'monitor-eye', 'config-keeper', 'incident-handler', 'doc-writer']
  },
  netops: {
    id: 'netops',
    name: 'NetOps',
    icon: '🌐',
    description: 'SSH to devices, pre-checks, health monitoring',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    icon: '🛡️',
    description: 'CVE monitoring, FortiGate/F5/Cisco advisories',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'firewall-pro': {
    id: 'firewall-pro',
    name: 'Firewall-Pro',
    icon: '🔥',
    description: 'FortiGate specialist — policies, NAT, VPN',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'loadbal-pro': {
    id: 'loadbal-pro',
    name: 'LoadBal-Pro',
    icon: '⚖️',
    description: 'F5 LTM/GTM — pools, SSL, health monitors',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'router-expert': {
    id: 'router-expert',
    name: 'Router-Expert',
    icon: '🔀',
    description: 'BGP, OSPF, routing — Cisco IOS-XR',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'monitor-eye': {
    id: 'monitor-eye',
    name: 'Monitor-Eye',
    icon: '👁️',
    description: 'Splunk, SNMP, alerts, thresholds',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'config-keeper': {
    id: 'config-keeper',
    name: 'Config-Keeper',
    icon: '📋',
    description: 'Config backups, change tracking, compliance',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'incident-handler': {
    id: 'incident-handler',
    name: 'Incident-Handler',
    icon: '🚨',
    description: 'Troubleshooting, RCA, incident docs',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  },
  'doc-writer': {
    id: 'doc-writer',
    name: 'Doc-Writer',
    icon: '📝',
    description: 'Diagrams, runbooks, SOPs, reports',
    status: 'idle',
    currentTask: null,
    lastUpdated: new Date().toISOString(),
    lastAction: 'Standing by for tasks'
  }
};

// Name → ID lookup map for @mention routing
const nameToId = {};
Object.values(agents).forEach(a => {
  nameToId[a.name.toLowerCase()] = a.id;
});

// Debate threads storage
const debateThreads = [];
let debateIdCounter = 0;

// Mention counts per agent (unread)
const mentionCounts = {};
AGENT_IDS.forEach(id => mentionCounts[id] = 0);

// Command queue for agents
const commandQueue = [];

// Connected WebSocket clients
const clients = new Set();

// Pause state
let isPaused = false;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Broadcast to all connected clients
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected. Total: ${clients.size}`);

  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      agents: Object.values(agents),
      tasks: getTasks(),
      files: getRecentFiles(),
      activity: getRecentActivity(),
      debates: debateThreads,
      mentionCounts: { ...mentionCounts },
      paused: isPaused
    },
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'command') {
        handleCommand(parsed.data);
      }
    } catch (e) {
      console.error('[WS] Invalid message:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });
});

// Handle commands from dashboard
function handleCommand(data) {
  const { agent, command } = data;
  const timestamp = new Date().toISOString();
  const agentName = agents[agent]?.name || agent;
  const agentIcon = agents[agent]?.icon || '🤖';

  // Log command to activity
  const logEntry = `[${timestamp}] [Dashboard] Command to ${agentName}: ${command}\n`;
  appendToActivityLog(logEntry);

  // Add to command queue
  commandQueue.push({ agent, command, timestamp, status: 'pending' });

  // Broadcast command sent (shows in chat as outgoing)
  broadcast('chat_message', {
    type: 'outgoing',
    agent,
    text: command,
    timestamp
  });

  // Check if command is an @mention (e.g., "@NetOps run prechecks")
  const mentionMatch = command.match(/^@([A-Za-z][\w-]*)\s+(.*)/);
  if (mentionMatch) {
    const targetName = mentionMatch[1];
    const mentionMessage = mentionMatch[2];
    const targetId = nameToId[targetName.toLowerCase()];

    if (targetId) {
      // Route as a mention from current agent to target
      broadcast('chat_message', {
        type: 'incoming',
        agent,
        agentName,
        agentIcon,
        text: `📨 @${agents[targetId].name} ${mentionMessage}`,
        timestamp
      });

      handleMention(agent, targetId, mentionMessage);

      // Also have the target agent process the command
      setTimeout(() => {
        simulateAgentAction(targetId, mentionMessage);
      }, 1500);
      return;
    }
  }

  // Check if command starts a debate
  const debateMatch = command.match(/^debate\s+(.*)/i);
  if (debateMatch) {
    startDebate(agent, debateMatch[1]);
    return;
  }

  // Check if command is a refute/agree/resolve in active debate
  const refuteMatch = command.match(/^refute\s+(.*)/i);
  if (refuteMatch && activeDebateId !== null) {
    addDebateMessage(agent, 'refute', refuteMatch[1]);
    return;
  }
  const agreeMatch = command.match(/^agree\s+(.*)/i);
  if (agreeMatch && activeDebateId !== null) {
    addDebateMessage(agent, 'agree', agreeMatch[1]);
    return;
  }
  if (command.toLowerCase() === 'resolve' && activeDebateId !== null) {
    resolveDebate(agent);
    return;
  }

  // Simulate agent receiving and processing the command
  setTimeout(() => {
    const ackTime = new Date().toISOString();

    // Agent acknowledgment
    broadcast('chat_message', {
      type: 'incoming',
      agent,
      agentName,
      agentIcon,
      text: `✅ Command received: "${command}"`,
      timestamp: ackTime
    });

    appendToActivityLog(`[${ackTime}] [${agentName}] Received command: ${command}\n`);

    // Simulate agent action based on command
    simulateAgentAction(agent, command);
  }, 500);
}

// Parse @mentions from text, returns array of {name, id}
function parseMentions(text) {
  const mentionRegex = /@([A-Za-z][\w-]*)/g;
  const found = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1];
    const id = nameToId[name.toLowerCase()];
    if (id) {
      found.push({ name: agents[id].name, id });
    }
  }
  return found;
}

// Handle an @mention between agents
function handleMention(fromAgentId, toAgentId, message) {
  const fromAgent = agents[fromAgentId];
  const toAgent = agents[toAgentId];
  if (!fromAgent || !toAgent) return;

  const timestamp = new Date().toISOString();

  // Increment mention count
  mentionCounts[toAgentId] = (mentionCounts[toAgentId] || 0) + 1;

  // Broadcast mention event (for badge flash + highlighting)
  broadcast('mention', {
    from: fromAgentId,
    fromName: fromAgent.name,
    fromIcon: fromAgent.icon,
    to: toAgentId,
    toName: toAgent.name,
    toIcon: toAgent.icon,
    message,
    mentionCounts: { ...mentionCounts },
    timestamp
  });

  // Log to MENTIONS.md
  const logEntry = `[${timestamp}] [@${fromAgent.name} → @${toAgent.name}] ${message}\n`;
  try {
    fs.appendFileSync(PATHS.mentionsLog, logEntry);
  } catch (e) {
    // Create file if it doesn't exist
    fs.writeFileSync(PATHS.mentionsLog, `# Agent @Mentions Log\n\n${logEntry}`);
  }

  // Log to activity
  appendToActivityLog(`[${timestamp}] [${fromAgent.name}] @mentioned ${toAgent.name}: ${message}\n`);

  // Simulate target agent acknowledging (1-2s delay)
  const responseDelay = 1000 + Math.random() * 1000;
  setTimeout(() => {
    const response = generateMentionResponse(toAgentId, fromAgentId, message);
    broadcast('chat_message', {
      type: 'incoming',
      agent: toAgentId,
      agentName: toAgent.name,
      agentIcon: toAgent.icon,
      text: response,
      timestamp: new Date().toISOString()
    });
    appendToActivityLog(`[${new Date().toISOString()}] [${toAgent.name}] Responded to @${fromAgent.name}\n`);
  }, responseDelay);
}

// Generate contextual response based on agent specialty
function generateMentionResponse(responderId, fromId, message) {
  const responder = agents[responderId];
  const from = agents[fromId];
  const msg = message.toLowerCase();

  const responses = {
    'netops': [
      `@${from.name} Roger that! Running network checks now...`,
      `@${from.name} On it — initiating device connectivity tests.`,
      `@${from.name} Acknowledged. Pulling latest device metrics.`
    ],
    'sentinel': [
      `@${from.name} Scanning threat feeds and CVE databases now.`,
      `@${from.name} Copy. Checking FortiGuard and NVD for advisories.`,
      `@${from.name} Acknowledged. Running security posture assessment.`
    ],
    'firewall-pro': [
      `@${from.name} Reviewing firewall policies and NAT rules.`,
      `@${from.name} On it — checking FortiGate config and rule base.`,
      `@${from.name} Acknowledged. Analyzing firewall change impact.`
    ],
    'loadbal-pro': [
      `@${from.name} Checking F5 pool status and health monitors.`,
      `@${from.name} Roger — reviewing VIP configurations and SSL profiles.`,
      `@${from.name} On it. Pulling F5 LTM/GTM status.`
    ],
    'router-expert': [
      `@${from.name} Checking BGP/OSPF adjacencies and routing tables.`,
      `@${from.name} Acknowledged. Reviewing routing topology.`,
      `@${from.name} On it — analyzing route convergence.`
    ],
    'monitor-eye': [
      `@${from.name} Checking Splunk dashboards and SNMP alerts.`,
      `@${from.name} On it — reviewing alert thresholds and baselines.`,
      `@${from.name} Acknowledged. Pulling monitoring data.`
    ],
    'config-keeper': [
      `@${from.name} Running config diff and compliance check.`,
      `@${from.name} Acknowledged. Checking for config drift.`,
      `@${from.name} On it — pulling latest backup snapshots.`
    ],
    'incident-handler': [
      `@${from.name} Standing by for incident triage and RCA.`,
      `@${from.name} Acknowledged. Preparing incident timeline.`,
      `@${from.name} On it — documenting the issue.`
    ],
    'doc-writer': [
      `@${from.name} I'll draft the documentation for this.`,
      `@${from.name} Acknowledged. Preparing runbook entry.`,
      `@${from.name} On it — updating the knowledge base.`
    ],
    'jarvis': [
      `@${from.name} Understood. I'll coordinate the team on this.`,
      `@${from.name} Copy. Triaging and assigning as needed.`,
      `@${from.name} Acknowledged. Monitoring progress.`
    ]
  };

  const agentResponses = responses[responderId] || [`@${from.name} Acknowledged. Working on it.`];
  return agentResponses[Math.floor(Math.random() * agentResponses.length)];
}

// ============ AGENT NLU — per-agent intent detection ============
function detectAgentIntent(agentId, command) {
  const t = command.toLowerCase();

  // BGP / routing queries
  if (/\b(bgp|ospf|isis|mpls|routing table|route|prefix|peer|neighbor|convergence|as path|as number|autonomous system)\b/.test(t)) {
    return 'bgp_status';
  }
  // Security / CVE queries
  if (/\b(cve|vuln|threat|security|advisory|patch|exploit|risk|scan|attack|malware|compromise|posture)\b/.test(t)) {
    return 'security_scan';
  }
  // Firewall queries
  if (/\b(firewall|policy|policies|rule|acl|nat|vpn|fortigate|fortios|permit|deny|block|filter|access[\s-]list)\b/.test(t)) {
    return 'firewall_check';
  }
  // Load balancer queries
  if (/\b(f5|load[\s-]?bal|vip|pool|member|health[\s-]?monitor|ssl offload|virtual[\s-]?server|ltm|gtm|irule|persistence)\b/.test(t)) {
    return 'lb_check';
  }
  // Monitoring / alerts
  if (/\b(alert|monitor|splunk|snmp|trap|threshold|metric|dashboard|syslog|log|event|alarm)\b/.test(t)) {
    return 'alert_check';
  }
  // Device configuration / change actions — BEFORE config_check (which is read-only audit)
  if (/\b(configure|create|provision|deploy|apply[\s-]?config|push[\s-]?config|commit[\s-]?change|rollback)\b/.test(t) ||
      (/\b(add|set|enable|disable|shut|no[\s-]?shut|bring[\s-]?(up|down)|remove|delete|unconfigure)\b/.test(t) &&
       /\b(interface|loopback|lo\d+|gigabit|gig\b|vlan|trunk|route|ntp|snmp|bgp[\s-]?neighbor|ospf|eigrp|description|ip[\s-]?add)\b/.test(t))) {
    return 'configure_device';
  }
  // Config / compliance
  if (/\b(config|backup|compliance|drift|change|diff|snapshot|baseline|audit|inventory)\b/.test(t)) {
    return 'config_check';
  }
  // Incident / RCA
  if (/\b(incident|rca|root[\s-]?cause|troubleshoot|diagnose|timeline|impact|outage report)\b/.test(t)) {
    return 'incident_check';
  }
  // Connectivity / pre-check
  if (/\b(precheck|pre[\s-]check|ssh|connect|reachab|connectivity|device health)\b/.test(t)) {
    return 'precheck';
  }
  // Ping
  if (/^(ping|test|alive|you there)[?!.\s]*$/.test(t)) {
    return 'ping';
  }
  // Help
  if (/\b(help|what can you|commands|capabilities)\b/.test(t)) {
    return 'help';
  }
  // Generic status / show / tell me → route to agent's domain check
  if (/\b(status|health|show|display|get|tell me|what'?s|how is|check|review|look at|give me|report on)\b/.test(t)) {
    return 'domain_status';
  }
  return 'general';
}

// Route a generic "status" query to the agent's own domain
function simulateAgentDomainStatus(agentId, command) {
  const domainMap = {
    'router-expert':    () => simulateBGPStatus(agentId),
    'sentinel':         () => simulateSecurityScan(agentId, command),
    'firewall-pro':     () => simulateFirewallCheck(agentId, command),
    'loadbal-pro':      () => simulateLBCheck(agentId, command),
    'monitor-eye':      () => simulateAlertCheck(agentId, command),
    'config-keeper':    () => simulateConfigCheck(agentId, command),
    'incident-handler': () => simulateIncidentCheck(agentId, command),
    'netops':           () => simulatePrecheck(agentId, command),
  };
  const fn = domainMap[agentId];
  if (fn) fn(); else simulateStatusCheck(agentId);
}

// When input doesn't match any pattern, agent interprets it contextually
function simulateAgentIntelligentResponse(agentId, command) {
  const agent = agents[agentId];
  const contextual = {
    'netops':           `🌐 Got it. Interpreting as a network ops request — analyzing intent and preparing action...`,
    'sentinel':         `🛡️ Understood. Treating this as a security request — launching threat assessment...`,
    'firewall-pro':     `🔥 On it. Interpreting as a firewall request — pulling policy base and FortiGate config...`,
    'loadbal-pro':      `⚖️ Roger. Treating this as a load balancer request — checking F5 pools and VIPs...`,
    'router-expert':    `🔀 Got it. Interpreting as a routing request — checking BGP peers and routing table...`,
    'monitor-eye':      `👁️ Understood. Treating this as a monitoring request — pulling latest Splunk alerts and SNMP traps...`,
    'config-keeper':    `📋 On it. Interpreting as a config request — running compliance and drift check...`,
    'incident-handler': `🚨 Got it. Treating this as an incident request — checking active incidents and RCA log...`,
    'doc-writer':       `📝 Understood. I'll draft documentation based on: "${command.slice(0, 60)}..."`,
  };

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
      text: contextual[agentId] || `🤖 Processing: "${command}"...`,
      timestamp: new Date().toISOString()
    });
  }, 350);

  // Follow through with the domain check
  setTimeout(() => simulateAgentDomainStatus(agentId, command), 1800);
}

// ── Router-Expert: BGP + routing status ──────────────────────────────────────
function simulateBGPStatus(agentId) {
  const agent = agents[agentId];
  const taskTitle = 'BGP Status Check';
  updateAgentStatus(agentId, 'active', 'Checking BGP status');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  const steps = [
    { delay: 400,  msg: '🔗 Connecting to core routers...' },
    { delay: 1100, msg: '📡 show bgp summary\n──────────────────────────────────\nBGP router identifier: 1.1.1.1   Local AS: 65001\nBGP table version: 526\n\nNeighbor        V  AS       State          Up/Down     PfxRcd\n10.0.0.1        4  65002    Established    3d 01:12      150\n10.0.0.2        4  65003    Established    5d 12:44      200\n10.0.0.3        4  65004    Established    2d 07:03      175\n10.0.0.4        4  65005    Idle(Admin)    never           0' },
    { delay: 2500, msg: '📡 show bgp ipv4 unicast statistics\n──────────────────────────────────\nRIB entries:    875     Memory: 546 KB\nPeers:          3 Established, 1 Idle\nPfx received:   525     Pfx advertised: 525' },
    { delay: 3700, msg: '📡 show ip route summary\n──────────────────────────────────\nRoute Source       Routes\nconnected          3\nstatic             1\nbgp 65001          525\nospf 1             47\n──────────────────────────────────\nTotal:             576 routes' },
    { delay: 5000, msg: '✅ BGP Status Report\n──────────────────────────────────\n🟢 Peers UP:    3  (AS65002 · AS65003 · AS65004)\n🔴 Peers DOWN:  1  (AS65005 — Admin shutdown)\n📊 Prefixes:    525 received / 525 advertised\n⏱  Best uptime: 5d 12h (AS65003)\n\n⚠️  Peer 10.0.0.4 (AS65005) is admin-shutdown.\n   Verify with Vikas before clearing — may be intentional.' },
  ];

  steps.forEach(s => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: s.msg, timestamp: new Date().toISOString()
      });
      updateAgentStatus(agentId, 'active', 'BGP check in progress');
    }, s.delay);
  });

  setTimeout(() => {
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] BGP status check complete — 3/4 peers UP\n`);
    updateAgentStatus(agentId, 'idle', 'BGP check complete — 3/4 peers UP');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 5600);
}

// ── Sentinel: Security / CVE scan ────────────────────────────────────────────
function simulateSecurityScan(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = 'Security & CVE Scan';
  updateAgentStatus(agentId, 'active', 'Running security scan');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  const steps = [
    { delay: 300,  msg: '🔍 Initiating security scan...' },
    { delay: 1000, msg: '📡 Querying threat feeds...\n  ✓ FortiGuard Labs\n  ✓ NIST NVD\n  ✓ CISA KEV database\n  ✓ CVE Mitre' },
    { delay: 2400, msg: '⚠️  CVE Findings:\n──────────────────────────────────\nCVE-2024-21762  FortiOS SSL-VPN  CRITICAL (9.8)\n  Auth bypass via crafted HTTP request\n  Affected: FortiOS 7.0.x < 7.0.14\n  Status: ❌ Patch NOT YET applied\n\nCVE-2023-27997  FortiOS SSL-VPN  CRITICAL (9.8)\n  Heap buffer overflow\n  Affected: FortiOS < 7.2.5\n  Status: ✅ PATCHED' },
    { delay: 3800, msg: '📊 Threat Posture Summary:\n──────────────────────────────────\n🔴 Critical (unpatched): 1\n🟠 High (patched):        3\n🟡 Medium:                7\n🟢 Low:                  12\n\n📋 Recommendation: Apply FortiOS 7.0.14 patch immediately.\n   Routing to Firewall-Pro for remediation.' },
  ];

  steps.forEach(s => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: s.msg, timestamp: new Date().toISOString()
      });
    }, s.delay);
  });

  setTimeout(() => {
    handleMention(agentId, 'firewall-pro', 'CVE-2024-21762 is unpatched on FortiGate. Please verify FortiOS version and schedule update to 7.0.14.');
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Security scan complete — 1 critical CVE unpatched\n`);
    updateAgentStatus(agentId, 'idle', 'Scan complete — 1 critical CVE unpatched');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 5000);
}

// ── Firewall-Pro: Policy and FortiGate check ─────────────────────────────────
function simulateFirewallCheck(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = 'Firewall Policy Check';
  updateAgentStatus(agentId, 'active', 'Checking FortiGate');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  const steps = [
    { delay: 350,  msg: '🔥 Connecting to FortiGate-600E...' },
    { delay: 1100, msg: `📡 get system status\n──────────────────────────────────\nModel:     FortiGate-600E\nFirmware:  FortiOS v7.0.13 build0566\nSerial:    FGT600E1234567\nHA Mode:   Standalone\nUptime:    48 days 03:22:11` },
    { delay: 2300, msg: '📡 show firewall policy | grep policyid\n──────────────────────────────────\nTotal policies: 142  |  Enabled: 138  |  Disabled: 4' },
    { delay: 3300, msg: '📡 Top hit policies (last 24h):\n──────────────────────────────────\nID 10  ALLOW LAN→WAN      48,293 hits\nID 22  ALLOW VPN→DMZ      12,841 hits\nID 35  BLOCK TOR-exits      1,204 blocked\nID 78  ALLOW DMZ→DB         3,891 hits' },
    { delay: 4500, msg: '✅ FortiGate Summary\n──────────────────────────────────\n🟢 Policies:   142 total, 138 active\n🟢 VPN:        14 tunnels UP, 0 DOWN\n🟠 FortiOS:    v7.0.13 — v7.0.14 available\n🟢 IPS:        Enabled  |  AV: Enabled\n\n⚠️  FortiOS 7.0.14 patches CVE-2024-21762 (Critical).\n   Schedule maintenance window to apply update.' },
  ];

  steps.forEach(s => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: s.msg, timestamp: new Date().toISOString()
      });
    }, s.delay);
  });

  setTimeout(() => {
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Firewall check complete — patch needed\n`);
    updateAgentStatus(agentId, 'idle', 'Firewall check complete — patch pending');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 5200);
}

// ── LoadBal-Pro: F5 BIG-IP check ─────────────────────────────────────────────
function simulateLBCheck(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = 'F5 LTM Status Check';
  updateAgentStatus(agentId, 'active', 'Checking F5 BIG-IP');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  const steps = [
    { delay: 400,  msg: '⚖️ Connecting to F5 BIG-IP...' },
    { delay: 1100, msg: '📡 show sys version\n──────────────────────────────────\nBIG-IP LTM  Version: 16.1.3.3\nHostname: bigip01.corp.local\nUptime:   12 days 07:14' },
    { delay: 2200, msg: '📡 show ltm pool\n──────────────────────────────────\nPool Name          Members  Active  Status\npool_web_443       4        4       ✅ Available\npool_api_8080      3        3       ✅ Available\npool_db_3306       2        2       ✅ Available\npool_legacy_80     2        1       ⚠️  Degraded\npool_admin_8443    2        2       ✅ Available' },
    { delay: 3400, msg: '📡 show ltm virtual (degraded only)\n──────────────────────────────────\nVIP 10.10.1.102:80  pool_legacy_80  ⚠️  Degraded\n  Member 10.0.2.45:80 — Connection refused\n  Member 10.0.2.46:80 — ✅ Available' },
    { delay: 4600, msg: '✅ F5 LTM Report\n──────────────────────────────────\n🟢 VIPs:        5 total, 4 fully available\n⚠️  Degraded:    pool_legacy_80 (1/2 members down)\n🟢 SSL certs:   All valid, no expiry in 30d\n🟢 System:      CPU 12%  |  Memory 34%\n\n📋 Action: NetOps to check 10.0.2.45:80 — may be process crash or firewall rule.' },
  ];

  steps.forEach(s => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: s.msg, timestamp: new Date().toISOString()
      });
    }, s.delay);
  });

  setTimeout(() => {
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] F5 check complete — 1 degraded pool\n`);
    updateAgentStatus(agentId, 'idle', 'F5 check complete — 1 degraded pool');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 5200);
}

// ── Monitor-Eye: Alerts and SNMP check ───────────────────────────────────────
function simulateAlertCheck(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = 'Alert & Monitor Check';
  updateAgentStatus(agentId, 'active', 'Checking alerts');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  const steps = [
    { delay: 300,  msg: '👁️ Querying monitoring systems...' },
    { delay: 1000, msg: '📡 Splunk — last 60 min:\n──────────────────────────────────\nERROR events:  23\nWARN events:  147\nINFO events:  8,431\n\nTop sources:\n  firewall-01:    8 errors\n  router-core:    6 errors\n  server-db01:    5 errors' },
    { delay: 2300, msg: '📡 SNMP Traps (last 1h):\n──────────────────────────────────\n09:15 linkDown    router-edge-01 Gi0/0/0/2\n09:17 linkUp      router-edge-01 Gi0/0/0/2  ← recovered\n09:31 cpuThreshold switch-core-02 (82%)\n09:41 bgpEstablished peer 10.0.0.3' },
    { delay: 3500, msg: '📡 Active threshold alerts:\n──────────────────────────────────\n🔴 switch-core-02  CPU 82%  (threshold: 80%)\n🟡 server-db01      Disk 78% (threshold: 75%)\n🟢 All other devices — normal' },
    { delay: 4600, msg: '✅ Monitoring Summary\n──────────────────────────────────\n🔴 Critical:  1  (switch-core-02 CPU spike)\n🟡 Warning:   1  (server-db01 disk)\n🟢 OK:        All other devices\n\n📋 Recommended actions:\n  → Investigate switch-core-02 CPU (possible routing loop)\n  → Schedule disk cleanup on server-db01\n  → router-edge-01 link flap at 09:15 was transient — resolved' },
  ];

  steps.forEach(s => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: s.msg, timestamp: new Date().toISOString()
      });
    }, s.delay);
  });

  setTimeout(() => {
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Alert check — 1 critical, 1 warning\n`);
    updateAgentStatus(agentId, 'idle', 'Alert check complete — 1 critical');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 5200);
}

// ── Config-Keeper: Compliance and drift check ─────────────────────────────────
function simulateConfigCheck(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = 'Config Compliance Check';
  updateAgentStatus(agentId, 'active', 'Running config compliance check');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  const steps = [
    { delay: 350,  msg: '📋 Loading configuration baselines...' },
    { delay: 1100, msg: '📡 Comparing running vs backup (24h delta):\n──────────────────────────────────\nrouter-core-01  ⚠️   2 changes\nswitch-core-01  ✅   0 changes\nfirewall-01     ⚠️   5 changes\nswitch-dist-01  ✅   0 changes\nrouter-edge-01  ⚠️   1 change' },
    { delay: 2400, msg: '⚠️  Drift details:\n──────────────────────────────────\nrouter-core-01:\n  + ip route 0.0.0.0/0 10.0.0.254  (added)\n  - ip route 10.10.0.0/16 10.0.0.1  (removed)\n\nfirewall-01:\n  + policy 143 ALLOW srv-new→internet\n  + address-object srv-new 10.10.5.20\n  ~ policy 22 description changed\n  + schedule recurring weekend-maint\n  - service custom-8181' },
    { delay: 3700, msg: '📡 Compliance audit:\n──────────────────────────────────\n✅ NTP servers:         Compliant\n✅ SNMPv3 only:         Compliant\n✅ Telnet disabled:     Compliant\n⚠️  SSH timeout:         Non-compliant (router-core-01: 60min, policy: 10min)\n⚠️  Password complexity: Non-compliant (2 devices)\n✅ Logging to SIEM:     Compliant' },
    { delay: 5000, msg: '✅ Config Report\n──────────────────────────────────\n📦 Backups:     All 5 devices backed up ✅\n⚠️  Drift:       8 changes across 3 devices\n🔴 Compliance:  2 failures (SSH timeout, password policy)\n\n📋 Firewall policy 143 needs CAB approval — new rule added without ticket.\n   SSH timeout remediation required on router-core-01.' },
  ];

  steps.forEach(s => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: s.msg, timestamp: new Date().toISOString()
      });
    }, s.delay);
  });

  setTimeout(() => {
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Config check — drift on 3 devices, 2 compliance failures\n`);
    updateAgentStatus(agentId, 'idle', 'Config check complete — 2 compliance failures');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 5600);
}

// ── Incident-Handler: Active incident check ───────────────────────────────────
function simulateIncidentCheck(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = 'Incident Status Check';
  updateAgentStatus(agentId, 'active', 'Checking active incidents');
  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
      text: '🚨 Checking active incidents...\n──────────────────────────────────\nActive incidents:    0\nResolved (24h):      2\n\n📋 Recent:\n[RESOLVED] INC-2024-089 — BGP peer flap AS65004  (resolved 2h ago)\n[RESOLVED] INC-2024-088 — SSL cert expiry warning server-api-02  (resolved 6h ago)\n\n✅ No active incidents. Squad is operating normally.',
      timestamp: new Date().toISOString()
    });
    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Incident check complete — 0 active\n`);
    updateAgentStatus(agentId, 'idle', 'Incident check complete — 0 active');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 1500);
}

// ── Main agent action dispatcher — NLU-driven ─────────────────────────────────
function simulateAgentAction(agentId, command) {
  const agent = agents[agentId];
  if (!agent) return;

  updateAgentStatus(agentId, 'active', `Processing: ${command}`);

  if (agentId === 'jarvis') {
    simulateJarvisAction(agentId, command);
    return;
  }

  const intent = detectAgentIntent(agentId, command);
  appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Intent: ${intent} — "${command.slice(0, 60)}"\n`);

  switch (intent) {
    case 'bgp_status':        return simulateBGPStatus(agentId);
    case 'security_scan':     return simulateSecurityScan(agentId, command);
    case 'firewall_check':    return simulateFirewallCheck(agentId, command);
    case 'lb_check':          return simulateLBCheck(agentId, command);
    case 'alert_check':       return simulateAlertCheck(agentId, command);
    case 'config_check':      return simulateConfigCheck(agentId, command);
    case 'incident_check':    return simulateIncidentCheck(agentId, command);
    case 'configure_device':  return simulateNetOpsConfig(agentId, command);
    case 'precheck':          return simulatePrecheck(agentId, command);
    case 'ping':              return simulatePing(agentId);
    case 'help':              return showAgentHelp(agentId);
    case 'domain_status':     return simulateAgentDomainStatus(agentId, command);
    default:                  return simulateAgentIntelligentResponse(agentId, command);
  }
}

// Simulate pre-check operation
function simulatePrecheck(agentId, command) {
  const agent = agents[agentId];
  const taskTitle = `Pre-check: ${command}`;

  // Create task in IN PROGRESS
  addTaskToBoard('inProgress', {
    title: taskTitle,
    agent: agent.name,
    completed: false
  });

  const steps = [
    { delay: 500,  msg: '🔄 Initializing pre-check sequence...', action: 'Initializing pre-check' },
    { delay: 1200, msg: '🔌 SSH connecting to sandbox-iosxr-1.cisco.com\n$ ssh admin@sandbox-iosxr-1.cisco.com\n  Username: admin\n  Password: C1sco12345\n  Port: 22', action: 'SSH connecting' },
    { delay: 2500, msg: '✅ SSH connection established\n  Banner: Cisco IOS XR Software, Version 7.3.2\n  Copyright (c) 2013-2023 by Cisco Systems, Inc.', action: 'Connected to device' },
    { delay: 3200, msg: '📡 Running: show version\n─────────────────────────────\nCisco IOS XR Software, Version 7.3.2\nCopyright (c) 2013-2023 by Cisco Systems\nUptime: 48 days, 3 hours, 17 minutes\nProcessor: RP/0/RSP0/CPU0\nSystem RAM: 16G total, 8.9G available', action: 'show version' },
    { delay: 4000, msg: '📡 Running: show ip interface brief\n─────────────────────────────\nInterface            IP-Address   Status   Protocol\nGig0/0/0/0           192.168.1.1  Up       Up\nGig0/0/0/1           10.0.0.1     Up       Up\nLoopback0            1.1.1.1      Up       Up', action: 'show ip interface brief' },
    { delay: 4800, msg: '📡 Running: show processes cpu | head 5\n─────────────────────────────\nCPU utilization for five seconds: 12%/3%\nPID  Runtime(ms)  Invoked  uSecs  5Sec  1Min  5Min  Process\n  1       139764   210263    665   0%    0%    0%  init\n  2         7808    23415    333   0%    0%    0%  kthreadd', action: 'show processes cpu' },
    { delay: 5600, msg: '📡 Running: show memory summary\n─────────────────────────────\nPhysical Memory:  16384M total\nApplication Memory: 8192M total (45% used)\nPage/cache Memory: 4096M\nFree Memory: 4096M', action: 'show memory summary' },
    { delay: 6400, msg: '📡 Running: show bgp summary\n─────────────────────────────\nBGP router identifier 1.1.1.1, local AS 65001\nNeighbor        AS    Up/Down   State     PfxRcd\n10.0.0.1        65002  3d01h    Established  150\n10.0.0.2        65003  5d12h    Established  200\n10.0.0.3        65004  2d07h    Established  175', action: 'Checking BGP status' },
    { delay: 7200, msg: '📡 Running: show route summary\n─────────────────────────────\nRoute Source       Routes  Backup  Deleted  Memory\nconnected          3       0       0        3120\nstatic             1       0       0        1040\nbgp 65001          525     0       0        546000\nOSPF 1             47      0       0        48880\nTotal              576     0       0        599040', action: 'show route summary' },
    { delay: 8000, msg: '📡 Running: show logging last 10\n─────────────────────────────\nLog Buffer (2097152 bytes):\n%OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.5 on Gi0/0/0/0 from LOADING to FULL\n%BGP-5-ADJCHANGE: neighbor 10.0.0.1 Up\n%LINK-3-UPDOWN: Interface GigabitEthernet0/0/0/0, changed state to up', action: 'show logging' },
    { delay: 8800, msg: '📝 All checks complete — generating report...', action: 'Writing report' },
  ];

  steps.forEach(step => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming',
        agent: agentId,
        agentName: agent.name,
        agentIcon: agent.icon,
        text: step.msg,
        timestamp: new Date().toISOString()
      });
      appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] ${step.action}\n`);
      updateAgentStatus(agentId, 'active', step.action);
    }, step.delay);
  });

  // Final completion
  setTimeout(() => {
    const reportName = `precheck-${Date.now()}.md`;
    const reportsDir = path.join(SQUAD_ROOT, 'agents', agentId, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, reportName);
    const reportContent = `# Pre-Check Report
**Device:** sandbox-iosxr-1.cisco.com
**Generated:** ${new Date().toISOString()}
**Agent:** ${agent.name}
**Command:** ${command}

## Summary
- Status: ✅ PASSED
- Connectivity: OK
- SSH: Connected
- CPU: 12%
- Memory: 45%
- Uptime: 48 days

## BGP Status
| Neighbor | State | Prefixes |
|----------|-------|----------|
| 10.0.0.1 | Established | 150 |
| 10.0.0.2 | Established | 200 |
| 10.0.0.3 | Established | 175 |

## Interfaces
- GigabitEthernet0/0/0/0: UP
- GigabitEthernet0/0/0/1: UP
- Loopback0: UP

## Conclusion
All pre-checks passed. Device is healthy and ready for changes.
`;

    fs.writeFileSync(reportPath, reportContent);

    broadcast('chat_message', {
      type: 'incoming',
      agent: agentId,
      agentName: agent.name,
      agentIcon: agent.icon,
      text: `✅ Pre-check complete!\n📁 Report saved: ${reportName}`,
      timestamp: new Date().toISOString()
    });

    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] ✅ Pre-check complete. Report: ${reportName}\n`);
    updateAgentStatus(agentId, 'idle', `Completed pre-check. Report: ${reportName}`);

    // Move task to DONE
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 10000);
}

// ============ NETOPS CONFIGURATION ENGINE ============

// Parse a configuration request to extract parameters
function parseNetOpsConfigRequest(command) {
  const t = command.toLowerCase();

  // Interface detection
  const loopbackMatch = t.match(/\blo(?:opback)?\s*(\d+)\b/);
  const giMatch = t.match(/\b(?:gi|gig|gigabit(?:ethernet)?)\s*([\d\/]+)\b/);
  const ethMatch = t.match(/\beth(?:ernet)?\s*([\d\/]+)\b/);

  // IP address
  const ipMatch = command.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  const prefixMatch = command.match(/\/(\d{1,2})\b/);

  // VLAN
  const vlanMatch = t.match(/\bvlan\s*(\d+)\b/);

  // Static route destination/next-hop
  const routeMatches = command.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g);

  // Description
  const descMatch = command.match(/description[:\s]+"?([^"]+)"?/i);

  // Determine config type
  let configType = 'general';
  let ifaceName = null;
  let ifaceShort = null;

  if (loopbackMatch) {
    configType = 'interface';
    ifaceName = `Loopback${loopbackMatch[1]}`;
    ifaceShort = `Lo${loopbackMatch[1]}`;
  } else if (giMatch) {
    configType = 'interface';
    ifaceName = `GigabitEthernet${giMatch[1]}`;
    ifaceShort = `Gi${giMatch[1]}`;
  } else if (ethMatch) {
    configType = 'interface';
    ifaceName = `Ethernet${ethMatch[1]}`;
    ifaceShort = `Et${ethMatch[1]}`;
  } else if (vlanMatch) {
    configType = 'vlan';
  } else if (/\b(static[\s-]?route|add[\s-]?route|ip[\s-]?route)\b/.test(t)) {
    configType = 'route';
  } else if (/\bntp\b/.test(t)) {
    configType = 'ntp';
  } else if (/\bsnmp\b/.test(t)) {
    configType = 'snmp';
  } else if (/\b(ospf)\b/.test(t)) {
    configType = 'ospf';
  } else if (/\b(no[\s-]?shut|bring[\s-]?up|enable[\s-]interface)\b/.test(t)) {
    configType = 'no_shutdown';
  } else if (/\b(shut|shutdown|disable[\s-]interface)\b/.test(t)) {
    configType = 'shutdown';
  } else if (/\bdescription\b/.test(t)) {
    configType = 'description';
  }

  return {
    configType,
    ifaceName,
    ifaceShort,
    ip: ipMatch ? ipMatch[1] : null,
    prefix: prefixMatch ? prefixMatch[1] : '32',
    mask: prefixMatch ? cidrToMask(parseInt(prefixMatch[1])) : '255.255.255.255',
    vlan: vlanMatch ? vlanMatch[1] : null,
    routeIPs: routeMatches || [],
    description: descMatch ? descMatch[1].trim() : `Configured by NetOps - ${new Date().toISOString().slice(0,10)}`
  };
}

function cidrToMask(prefix) {
  const masks = {
    32: '255.255.255.255', 30: '255.255.255.252', 29: '255.255.255.248',
    28: '255.255.255.240', 27: '255.255.255.224', 26: '255.255.255.192',
    25: '255.255.255.128', 24: '255.255.255.0',   23: '255.255.254.0',
    22: '255.255.252.0',   16: '255.255.0.0',      8: '255.0.0.0'
  };
  return masks[prefix] || '255.255.255.0';
}

// Build config steps based on parsed request
function buildNetOpsConfigSteps(parsed, command, agentName) {
  const { configType, ifaceName, ifaceShort, ip, prefix, mask, vlan, description } = parsed;
  const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  switch (configType) {

    case 'interface': {
      const iface = ifaceName || 'Loopback0';
      const short = ifaceShort || 'Lo0';
      const addr = ip || '10.10.10.1';
      const isLoopback = iface.startsWith('Loopback');
      return [
        { delay: 400,  action: 'Analyzing request',
          msg: `🔍 Analyzing configuration request...\n• Type: Interface configuration\n• Interface: ${iface}\n• IP Address: ${addr}/${prefix}\n• Action: Create & bring up` },
        { delay: 1300, action: 'Pre-check: verifying interface',
          msg: `📋 Pre-check: Verifying ${iface} on sandbox-iosxr-1.cisco.com\n─────────────────────────────────\n$ show interfaces ${iface} brief\nInterface ${iface} — not found ✅ Safe to proceed` },
        { delay: 2400, action: 'SSH connecting',
          msg: `🔌 Connecting to device...\n$ ssh admin@sandbox-iosxr-1.cisco.com\nWarning: Permanently added 'sandbox-iosxr-1.cisco.com' to known hosts.\n✅ Connected — Cisco IOS XR 7.3.2` },
        { delay: 3400, action: 'Entering config mode',
          msg: `⚙️  Entering configuration mode...\nRP/0/RSP0/CPU0:sandbox-iosxr-1#configure terminal\nEntering configuration mode terminal\nUncommitted changes found, use 'show commit changes diff'` },
        { delay: 4600, action: `Configuring ${iface}`,
          msg: `📝 Applying interface configuration...\n─────────────────────────────────\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#interface ${iface}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-if)#ipv4 address ${addr} ${mask}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-if)#no shutdown\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-if)#description ${description}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-if)#exit` },
        { delay: 6000, action: 'Committing changes',
          msg: `💾 Committing configuration...\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#commit\n${ts()}\n% Commit succeeded.\nConfiguration committed by ${agentName}` },
        { delay: 7400, action: 'Verifying interface UP',
          msg: `✅ Verification: ${iface} status\n─────────────────────────────────\n$ show interfaces ${iface}\n${iface} is up, line protocol is up\n  Description: ${description}\n  Internet Address is ${addr}/${prefix}\n  MTU 1500 bytes, BW 8000000 Kbit\n  Last link flapped 00:00:02 ago` },
        { delay: 8800, action: 'Connectivity test',
          msg: `🏓 Connectivity test: ping ${addr}\n─────────────────────────────────\n$ ping ${addr} source Loopback0 count 5\nSending 5, 100-byte ICMP Echos to ${addr}\n!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 1/1/2 ms` },
      ];
    }

    case 'vlan': {
      const vid = vlan || '100';
      return [
        { delay: 400,  action: 'Analyzing VLAN request',
          msg: `🔍 Analyzing VLAN configuration request...\n• VLAN ID: ${vid}\n• Action: Create VLAN` },
        { delay: 1200, action: 'Pre-check: VLAN database',
          msg: `📋 Pre-check: Checking VLAN database\n$ show vlan brief | grep ${vid}\nVLAN ${vid} — not found ✅ Safe to create` },
        { delay: 2400, action: 'SSH connecting',
          msg: `🔌 Connected to sandbox-iosxr-1.cisco.com ✅` },
        { delay: 3400, action: `Creating VLAN ${vid}`,
          msg: `📝 Creating VLAN ${vid}...\n─────────────────────────────────\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#vlan ${vid}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-vlan)#name VLAN_${vid}_NetOps\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-vlan)#state active\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-vlan)#exit` },
        { delay: 4800, action: 'Committing VLAN config',
          msg: `💾 Committing...\n${ts()}\n% Commit succeeded.` },
        { delay: 6000, action: 'Verifying VLAN',
          msg: `✅ Verification:\n$ show vlan id ${vid}\nVLAN  Name                Status\n${vid}    VLAN_${vid}_NetOps    active` },
      ];
    }

    case 'route': {
      const dest = parsed.routeIPs[0] || '0.0.0.0';
      const nextHop = parsed.routeIPs[1] || '192.168.1.254';
      return [
        { delay: 400,  action: 'Analyzing route request',
          msg: `🔍 Analyzing static route request...\n• Destination: ${dest}/${prefix}\n• Next-Hop: ${nextHop}` },
        { delay: 1400, action: 'Pre-check: routing table',
          msg: `📋 Pre-check: Checking routing table\n$ show route ${dest}\nRoute not found ✅ Safe to add` },
        { delay: 2600, action: 'SSH connecting',
          msg: `🔌 Connected to sandbox-iosxr-1.cisco.com ✅` },
        { delay: 3600, action: `Adding static route`,
          msg: `📝 Adding static route...\n─────────────────────────────────\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#router static\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-static)#address-family ipv4 unicast\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-static-afi)#${dest}/${prefix} ${nextHop}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-static-afi)#exit` },
        { delay: 5000, action: 'Committing route',
          msg: `💾 Committing...\n${ts()}\n% Commit succeeded.` },
        { delay: 6200, action: 'Verifying route',
          msg: `✅ Route in table:\n$ show route ${dest}\nS    ${dest}/${prefix} [1/0] via ${nextHop}, GigabitEthernet0/0/0/0` },
      ];
    }

    case 'ntp': {
      const ntpServer = ip || '216.239.35.0';
      return [
        { delay: 400,  action: 'Analyzing NTP request',
          msg: `🔍 Analyzing NTP configuration...\n• NTP Server: ${ntpServer}` },
        { delay: 1400, action: 'Pre-check: NTP status',
          msg: `📋 Pre-check: Current NTP status\n$ show ntp status\nClock is unsynchronized — configuring NTP server` },
        { delay: 2600, action: 'Configuring NTP',
          msg: `📝 Configuring NTP server...\n─────────────────────────────────\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#ntp server ${ntpServer} prefer\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#ntp update-calendar` },
        { delay: 4000, action: 'Committing NTP config',
          msg: `💾 Committing...\n${ts()}\n% Commit succeeded.` },
        { delay: 5400, action: 'Verifying NTP sync',
          msg: `✅ NTP Verification:\n$ show ntp associations\n  address         ref clock   st   when  poll reach  delay  offset\n*~${ntpServer}   .GOOG.      1     12    64   377  1.483  +0.231\n* sys.peer, # selected, + candidate, - outlier` },
      ];
    }

    case 'shutdown': {
      const iface = ifaceName || 'GigabitEthernet0/0/0/1';
      return [
        { delay: 400,  action: 'Analyzing shutdown request',
          msg: `🔍 Shutdown request: ${iface}` },
        { delay: 1400, action: 'Pre-check: interface state',
          msg: `📋 Pre-check: ${iface} is currently UP — proceeding with shutdown` },
        { delay: 2600, action: `Shutting down ${iface}`,
          msg: `📝 Applying shutdown...\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#interface ${iface}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-if)#shutdown` },
        { delay: 3800, action: 'Committing shutdown',
          msg: `💾 Committing...\n% Commit succeeded.` },
        { delay: 5000, action: 'Verifying interface down',
          msg: `✅ Verification:\n$ show interfaces ${iface} brief\n${iface} is admin-down, line protocol is down` },
      ];
    }

    case 'no_shutdown': {
      const iface = ifaceName || 'GigabitEthernet0/0/0/1';
      return [
        { delay: 400,  action: 'Analyzing no-shutdown request',
          msg: `🔍 No-shutdown request: ${iface}` },
        { delay: 1400, action: 'Pre-check: interface state',
          msg: `📋 Pre-check: ${iface} is currently admin-down — proceeding to bring up` },
        { delay: 2600, action: `Bringing up ${iface}`,
          msg: `📝 Applying no shutdown...\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#interface ${iface}\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config-if)#no shutdown` },
        { delay: 3800, action: 'Committing interface up',
          msg: `💾 Committing...\n% Commit succeeded.` },
        { delay: 5200, action: 'Verifying interface UP',
          msg: `✅ Verification:\n$ show interfaces ${iface} brief\n${iface} is up, line protocol is up\nLast link flapped 00:00:01 ago` },
      ];
    }

    default: {
      // Generic config fallback
      return [
        { delay: 400,  action: 'Analyzing configuration request',
          msg: `🔍 Analyzing request: "${command.slice(0, 60)}"\n• Preparing configuration sequence...` },
        { delay: 1500, action: 'Running pre-check',
          msg: `📋 Pre-check: Verifying current device state...\n$ show running-config | relevant\n✅ Device reachable and ready for changes` },
        { delay: 2800, action: 'SSH connecting',
          msg: `🔌 Connected to sandbox-iosxr-1.cisco.com ✅\nCisco IOS XR Software, Version 7.3.2` },
        { delay: 4000, action: 'Applying configuration',
          msg: `📝 Applying configuration...\nRP/0/RSP0/CPU0:sandbox-iosxr-1(config)#${command.slice(0, 60)}\nConfiguration accepted.` },
        { delay: 5500, action: 'Committing changes',
          msg: `💾 Committing...\n${ts()}\n% Commit succeeded.` },
        { delay: 7000, action: 'Verifying changes',
          msg: `✅ Change verification passed — configuration is active.` },
      ];
    }
  }
}

// Main NetOps configuration dispatcher
function simulateNetOpsConfig(agentId, command) {
  const agent = agents[agentId];
  const parsed = parseNetOpsConfigRequest(command);
  const taskTitle = `Configure: ${command.slice(0, 48)}`;

  addTaskToBoard('inProgress', {
    title: taskTitle,
    agent: agent.name,
    priority: 'HIGH',
    completed: false,
    createdAt: new Date().toISOString()
  });

  updateAgentStatus(agentId, 'active', `Configuring: ${command.slice(0, 40)}`);
  appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] Config request [${parsed.configType}]: ${command}\n`);

  broadcast('chat_message', {
    type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
    text: `🔧 **NetOps Configuration Engine**\nProcessing: "${command.slice(0, 60)}"\nType detected: ${parsed.configType.replace('_', ' ').toUpperCase()}`,
    timestamp: new Date().toISOString()
  });

  const steps = buildNetOpsConfigSteps(parsed, command, agent.name);

  steps.forEach(step => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
        text: step.msg, timestamp: new Date().toISOString()
      });
      if (step.action) {
        appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] ${step.action}\n`);
        updateAgentStatus(agentId, 'active', step.action);
      }
    }, step.delay);
  });

  // Final completion
  const lastDelay = steps[steps.length - 1].delay + 1800;
  setTimeout(() => {
    const reportName = `config-change-${Date.now()}.md`;
    const reportsDir = path.join(SQUAD_ROOT, 'agents', agentId, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, reportName);
    const reportContent = [
      `# Configuration Change Report`,
      `**Device:** sandbox-iosxr-1.cisco.com`,
      `**Agent:** ${agent.name}`,
      `**Type:** ${parsed.configType}`,
      `**Timestamp:** ${new Date().toISOString()}`,
      `**Command:** ${command}`,
      ``,
      `## Parameters`,
      parsed.ifaceName  ? `- Interface: ${parsed.ifaceName}` : '',
      parsed.ip         ? `- IP Address: ${parsed.ip}/${parsed.prefix}` : '',
      parsed.vlan       ? `- VLAN: ${parsed.vlan}` : '',
      ``,
      `## Result`,
      `- Status: ✅ SUCCESS`,
      `- Committed: Yes`,
      `- Verification: Passed`,
    ].filter(Boolean).join('\n');
    fs.writeFileSync(reportPath, reportContent);

    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: agent.name, agentIcon: agent.icon,
      text: `✅ **Configuration Complete!**\n📋 Change log: ${reportName}\n🔒 Committed to device — rollback available if needed`,
      timestamp: new Date().toISOString()
    });

    appendToActivityLog(`[${new Date().toISOString()}] [${agent.name}] ✅ Config complete [${parsed.configType}]. Report: ${reportName}\n`);
    updateAgentStatus(agentId, 'idle', `Config complete: ${reportName}`);
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, lastDelay);
}

// Simulate status check
function simulateStatusCheck(agentId) {
  const agent = agents[agentId];
  const taskTitle = 'Status check';

  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming',
      agent: agentId,
      agentName: agent.name,
      agentIcon: agent.icon,
      text: `📊 Agent Status:\n• Name: ${agent.name}\n• Status: ${agent.status}\n• Last Action: ${agent.lastAction}\n• Ready for commands: Yes`,
      timestamp: new Date().toISOString()
    });
    updateAgentStatus(agentId, 'idle', 'Status reported');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 1000);
}

// Simulate ping test
function simulatePing(agentId) {
  const agent = agents[agentId];
  const taskTitle = 'Connectivity test (ping)';

  addTaskToBoard('inProgress', { title: taskTitle, agent: agent.name });

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming',
      agent: agentId,
      agentName: agent.name,
      agentIcon: agent.icon,
      text: `🏓 Pong! Agent is responsive.\nLatency: 2ms\nUptime: ${Math.floor(process.uptime())}s`,
      timestamp: new Date().toISOString()
    });
    updateAgentStatus(agentId, 'idle', 'Ping responded');
    moveTaskOnBoard(taskTitle, 'inProgress', 'done');
  }, 500);
}

// Show agent help
function showAgentHelp(agentId) {
  const agent = agents[agentId];

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming',
      agent: agentId,
      agentName: agent.name,
      agentIcon: agent.icon,
      text: `📚 **NetOps — Capabilities**\n\n🔧 **Configuration (new)**\n• configure interface lo10 with 10.0.0.1 — Create loopback/GigE interface\n• add vlan 100 — Create VLAN\n• add static route 10.0.0.0/24 via 192.168.1.1 — Add route\n• configure ntp server 216.239.35.0 — Set NTP\n• shut interface gi0/0/0/1 — Shutdown interface\n• no shut interface gi0/0/0/1 — Bring up interface\n\n📋 **Health Checks**\n• run prechecks — Full device health check\n• status — Agent status\n• ping — Test connectivity\n• help — This help`,
      timestamp: new Date().toISOString()
    });
    updateAgentStatus(agentId, 'idle', 'Help displayed');
  }, 500);
}

// ============ JARVIS NLU — NATURAL LANGUAGE UNDERSTANDING ============

// Score-based intent classifier: returns the best matching intent
function detectJarvisIntent(input) {
  const t = input.toLowerCase().trim();

  const intents = [
    {
      type: 'standup',
      patterns: [
        /\b(standup|stand[\s-]up)\b/,
        /\b(morning brief|daily brief|daily check|start of day|kick[\s-]?off)\b/,
        /\b(check[\s-]?in with|how is everyone|how'?s everyone|what'?s everyone (doing|working on))\b/,
        /\b(team (check|update|brief|status)|brief me|get a status|everyone doing)\b/,
        /\b(good morning|start the day|begin the day|open the day)\b/
      ]
    },
    {
      type: 'squad_status',
      patterns: [
        /\b(roll[\s-]?call|squad status|agent (roster|list|status))\b/,
        /\bwho'?s? (online|active|available|working|up|running)\b/,
        /\b(show|list|see|get) (me )?(all |the )?agents\b/,
        /\bhow many agents\b/,
        /\b(everyone online|all agents|who do we have|team roster|see the team|check on everyone)\b/,
        /\b(who is (available|online|active)|any agents (available|active|online))\b/
      ]
    },
    {
      type: 'weekly_report',
      patterns: [
        /\b(weekly report|week(ly)? summary|summary report|progress report)\b/,
        /\b(what'?s? been done|what (have|did) we (complete|accomplish|finish|do))\b/,
        /\b(overview of the week|week recap|how did we do|activity (summary|report))\b/,
        /\b(our progress|completed this week|this week'?s? work|wrap[\s-]?up)\b/
      ]
    },
    {
      type: 'escalate',
      patterns: [
        /\b(escalate|urgent|critical|emergency|p0|p1)\b/,
        /\b(major (incident|outage|issue|problem)|production (down|issue|problem|outage))\b/,
        /\b(is down|went down|has gone down|not (working|responding|reachable))\b/,
        /\b(outage|disaster|crisis|major failure|complete failure|total (loss|outage))\b/,
        /\b(needs? immediate|right now|asap|right away|immediately)\b/,
        /\b(broken|failed|failure|dead|unreachable|timed? out|packet[\s-]?loss)\b/,
        /\b(bgp (down|drop|flap|fail)|ospf (down|fail)|link (down|fail)|interface (down|fail))\b/,
        /\b(cpu (maxed|spiked|100%)|memory (full|exhausted|oom)|disk (full|100%))\b/
      ]
    },
    {
      type: 'triage',
      patterns: [
        /\b(triage|assign|delegate|route|dispatch)\b/,
        /\b(can (someone|an agent|you)|need (someone|an agent) to|who should (handle|look|check|fix))\b/,
        /\b(please (assign|handle|look into|check|fix|investigate))\b/,
        /\b(take care of|work on (this|it)|look into|check (on|out)|investigate)\b/,
        /\b(I have a task|new task|there'?s? a (task|ticket|issue|job|problem|request))\b/,
        /\b(add (this|a) task|create (a )?task|log (this|a) task|put (this|it) in)\b/,
        /\b(deal with|handle this|sort (this|it) out|take a look)\b/
      ]
    },
    {
      type: 'ping',
      patterns: [
        /^(hi|hey|hello|howdy|yo|sup|hiya)[!?.\s]*$/,
        /^(ping|test|testing|you there|are you there|you awake|online)[?!.\s]*$/,
        /^(hey jarvis|hi jarvis|hello jarvis)[!?.\s]*$/
      ]
    },
    {
      type: 'help',
      patterns: [
        /\b(help|what can you (do|help)|what are your (commands|capabilities))\b/,
        /\b(how do (i|you)|what do you (do|know|understand)|your (commands|options|features))\b/,
        /\b(guide|instructions|capabilities|show me what you can)\b/
      ]
    }
  ];

  // Score each intent
  for (const intent of intents) {
    for (const pattern of intent.patterns) {
      if (pattern.test(t)) {
        return { type: intent.type };
      }
    }
  }

  // Contextual inference — network/infra issue descriptions
  const isNetworkTerm = /\b(bgp|ospf|isis|mpls|vlan|stp|spanning.tree|routing|interface|switch|router|firewall|fortigate|f5|load.?bal|vpn|tunnel|ipsec|ssl|certificate|cpu|memory|disk|latency|bandwidth|utilization|syslog|snmp|trap|acl|policy|nat|vip|pool|bgp|peer|prefix|route|nexthop|convergence)\b/.test(t);
  const isProblem = /\b(down|fail|error|high|spike|maxed|full|loss|issue|problem|broken|unreachable|timeout|flap|drop|slow|congested|blocked|denied|rejected|expired|mismatch|loop|storm)\b/.test(t);

  if (isNetworkTerm && isProblem) {
    return { type: 'escalate', inferred: true };
  }
  if (isNetworkTerm) {
    return { type: 'triage', inferred: true };
  }

  // Agent-name mentions — likely a routing request
  const agentNames = ['netops', 'sentinel', 'firewall', 'loadbal', 'router', 'monitor', 'config', 'incident', 'doc-writer', 'doc writer'];
  if (agentNames.some(n => t.includes(n))) {
    return { type: 'triage', inferred: true };
  }

  return { type: 'general' };
}

// Strip leading intent words and greetings to extract the clean subject
function extractJarvisSubject(input) {
  return input
    .replace(/^(hey|hi|hello)[,\s]+jarvis[,.\s]*/i, '')
    .replace(/^jarvis[,.\s]*/i, '')
    .replace(/^(please|can you|could you|would you)[,\s]*/i, '')
    .replace(/^(triage|assign|escalate|handle|deal with|look into|check on|investigate|route|delegate)[,\s]*/i, '')
    .replace(/^(there'?s?|i have|we have|we need)[,\s]*/i, '')
    .trim() || input.trim();
}

// When intent is genuinely unclear, Jarvis reasons through it and acts
function simulateJarvisGeneralResponse(agentId, command) {
  const jarvis = agents[agentId];
  const subject = extractJarvisSubject(command);

  // Jarvis acknowledges in natural language, then decides what to do
  const acknowledgements = [
    `Got it — let me figure out the best way to handle: "${subject}"`,
    `Understood. Analyzing: "${subject}" — routing to the right agent now.`,
    `On it. I'll triage "${subject}" to the most relevant squad member.`,
    `Roger that. Processing: "${subject}"`
  ];
  const ack = acknowledgements[Math.floor(Math.random() * acknowledgements.length)];

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `🎖️ ${ack}`,
      timestamp: new Date().toISOString()
    });
    appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] Processing general request: "${subject}"\n`);
  }, 300);

  // Then triage it to the best-fit agent
  setTimeout(() => simulateTriage(agentId, subject), 1800);
}

// Main Jarvis entry point — intent-driven, no fixed commands
function simulateJarvisAction(agentId, command) {
  const intent = detectJarvisIntent(command);
  const subject = extractJarvisSubject(command);

  appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] Intent: ${intent.type}${intent.inferred ? ' (inferred)' : ''} — "${command.slice(0, 60)}"\n`);

  switch (intent.type) {
    case 'standup':        return simulateStandup(agentId);
    case 'squad_status':   return simulateSquadStatus(agentId);
    case 'weekly_report':  return simulateWeeklyReport(agentId);
    case 'escalate':       return simulateEscalation(agentId, subject);
    case 'triage':         return simulateTriage(agentId, subject);
    case 'ping':           return simulatePing(agentId);
    case 'help':           return showJarvisHelp(agentId);
    default:               return simulateJarvisGeneralResponse(agentId, command);
  }
}

// Jarvis: Daily standup — collect status from all agents
function simulateStandup(agentId) {
  const jarvis = agents[agentId];
  updateAgentStatus(agentId, 'active', 'Running daily standup');
  addTaskToBoard('inProgress', { title: 'Daily Standup', agent: 'Jarvis' });

  const managedAgents = jarvis.manages || [];

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `📢 **DAILY STANDUP — ${new Date().toLocaleDateString()}**\nCollecting status from ${managedAgents.length} agents...`,
      timestamp: new Date().toISOString()
    });
    appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] Daily standup initiated\n`);
  }, 500);

  let delay = 1500;
  const statusLines = [];

  managedAgents.forEach((id) => {
    const a = agents[id];
    setTimeout(() => {
      const statusIcon = a ? (a.status === 'active' ? '🟢' : a.status === 'idle' ? '🟡' : '🔴') : '⚫';
      const name = a ? a.name : id;
      const icon = a ? a.icon : '🤖';
      const action = a ? a.lastAction : 'Not deployed';
      const line = `${statusIcon} ${icon} **${name}** — ${action}`;
      statusLines.push(line);

      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
        text: `${statusIcon} ${icon} ${name}: ${action}`,
        timestamp: new Date().toISOString()
      });
    }, delay);
    delay += 800;
  });

  setTimeout(() => {
    const activeCount = managedAgents.filter(id => agents[id]?.status === 'active').length;
    const idleCount = managedAgents.filter(id => agents[id]?.status === 'idle').length;
    const offlineCount = managedAgents.length - activeCount - idleCount;

    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `📊 **Standup Summary**\n🟢 Active: ${activeCount} | 🟡 Idle: ${idleCount} | 🔴 Offline: ${offlineCount}\n✅ Standup complete. All agents accounted for.`,
      timestamp: new Date().toISOString()
    });

    appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] Standup complete — Active: ${activeCount}, Idle: ${idleCount}, Offline: ${offlineCount}\n`);
    updateAgentStatus(agentId, 'active', 'Standup complete — monitoring squad');
    moveTaskOnBoard('Daily Standup', 'inProgress', 'done');
  }, delay + 500);
}

// Jarvis: Squad status / roll call
function simulateSquadStatus(agentId) {
  const jarvis = agents[agentId];
  updateAgentStatus(agentId, 'active', 'Checking squad status');

  setTimeout(() => {
    const managedAgents = jarvis.manages || [];
    const lines = managedAgents.map(id => {
      const a = agents[id];
      if (!a) return `⚫ 🤖 ${id} — Not deployed`;
      const statusIcon = a.status === 'active' ? '🟢' : a.status === 'idle' ? '🟡' : '🔴';
      return `${statusIcon} ${a.icon} ${a.name} — ${a.lastAction}`;
    });

    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `🎖️ **Squad Status Report**\n━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━\nTotal: ${managedAgents.length} agents`,
      timestamp: new Date().toISOString()
    });
    updateAgentStatus(agentId, 'active', 'Monitoring squad');
  }, 1000);
}

// Jarvis: Triage/assign a task
function simulateTriage(agentId, command) {
  const jarvis = agents[agentId];
  updateAgentStatus(agentId, 'active', 'Triaging task');

  const taskText = command.replace(/^(triage|assign)\s*/i, '').trim() || 'Incoming task';

  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `🔍 Triaging: "${taskText}"`,
      timestamp: new Date().toISOString()
    });
  }, 500);

  setTimeout(() => {
    // Auto-assign based on keywords
    let assignTo = 'netops';
    if (taskText.match(/firewall|acl|policy|rule/i)) assignTo = 'firewall-pro';
    else if (taskText.match(/load.?bal|f5|vip|pool/i)) assignTo = 'loadbal-pro';
    else if (taskText.match(/route|bgp|ospf|isis|path/i)) assignTo = 'router-expert';
    else if (taskText.match(/monitor|alert|snmp|syslog/i)) assignTo = 'monitor-eye';
    else if (taskText.match(/config|backup|compliance|drift/i)) assignTo = 'config-keeper';
    else if (taskText.match(/incident|outage|down|critical/i)) assignTo = 'incident-handler';
    else if (taskText.match(/doc|runbook|wiki|document/i)) assignTo = 'doc-writer';
    else if (taskText.match(/security|threat|vuln|scan/i)) assignTo = 'sentinel';

    const assignedAgent = agents[assignTo];
    const assignedName = assignedAgent ? assignedAgent.name : assignTo;
    const assignedIcon = assignedAgent ? assignedAgent.icon : '🤖';

    addTaskToBoard('inbox', { title: taskText, agent: assignedName });

    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `✅ Task triaged & assigned:\n📋 "${taskText}"\n➡️ Assigned to: ${assignedIcon} **${assignedName}**\n📥 Added to INBOX\n\n@${assignedName} I'm assigning you: ${taskText}`,
      timestamp: new Date().toISOString()
    });

    // Route the @mention to the assigned agent
    handleMention(agentId, assignTo, `I'm assigning you: ${taskText}`);

    // After acknowledgment, trigger the assigned agent to actually execute the task
    setTimeout(() => {
      simulateAgentAction(assignTo, taskText);
    }, 3000);

    appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] Triaged task "${taskText}" → assigned to ${assignedName}\n`);
    updateAgentStatus(agentId, 'active', `Assigned "${taskText}" to ${assignedName}`);
  }, 2000);
}

// Jarvis: Weekly summary report
function simulateWeeklyReport(agentId) {
  const jarvis = agents[agentId];
  updateAgentStatus(agentId, 'active', 'Generating weekly report');
  addTaskToBoard('inProgress', { title: 'Weekly Summary Report', agent: 'Jarvis' });

  const steps = [
    { delay: 500, msg: '📊 Generating weekly squad report...' },
    { delay: 1500, msg: '📁 Scanning task history...' },
    { delay: 2500, msg: '📈 Analyzing agent performance...' },
  ];

  steps.forEach(step => {
    setTimeout(() => {
      broadcast('chat_message', {
        type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
        text: step.msg,
        timestamp: new Date().toISOString()
      });
    }, step.delay);
  });

  setTimeout(() => {
    const tasks = getTasks();
    const doneCount = (tasks.done || []).length;
    const inProgressCount = (tasks.inProgress || []).length;
    const inboxCount = (tasks.inbox || []).length;
    const managedAgents = jarvis.manages || [];
    const activeCount = managedAgents.filter(id => agents[id]?.status === 'active').length;

    const reportContent = `# Weekly Squad Report
**Generated:** ${new Date().toISOString()}
**Squad Lead:** Jarvis 🎖️

## Squad Overview
- Total Agents: ${managedAgents.length}
- Active: ${activeCount}
- Idle: ${managedAgents.length - activeCount}

## Task Summary
- Completed: ${doneCount}
- In Progress: ${inProgressCount}
- Inbox: ${inboxCount}

## Agent Status
${managedAgents.map(id => {
  const a = agents[id];
  if (!a) return `| ${id} | Not Deployed | - |`;
  return `| ${a.icon} ${a.name} | ${a.status} | ${a.lastAction} |`;
}).join('\n')}

## Recommendations
- ${inboxCount > 0 ? `${inboxCount} tasks pending triage in INBOX` : 'All tasks triaged'}
- ${activeCount === 0 ? 'No agents currently active — consider scheduling tasks' : `${activeCount} agents actively working`}

---
*Report generated by Jarvis, Network Squad Lead*
`;

    const reportName = `weekly-report-${Date.now()}.md`;
    const reportPath = path.join(SQUAD_ROOT, 'agents', 'jarvis', reportName);
    fs.writeFileSync(reportPath, reportContent);

    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `✅ **Weekly Report Complete**\n📋 Tasks — Done: ${doneCount} | Active: ${inProgressCount} | Inbox: ${inboxCount}\n👥 Squad — ${managedAgents.length} agents, ${activeCount} active\n📁 Report saved: ${reportName}`,
      timestamp: new Date().toISOString()
    });

    appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] Weekly report generated: ${reportName}\n`);
    updateAgentStatus(agentId, 'active', `Weekly report: ${reportName}`);
    moveTaskOnBoard('Weekly Summary Report', 'inProgress', 'done');
  }, 4000);
}

// Jarvis: Escalation
function simulateEscalation(agentId, command) {
  const jarvis = agents[agentId];
  const issue = command.replace(/^(escalate|alert|critical)\s*/i, '').trim() || 'Unspecified critical issue';

  updateAgentStatus(agentId, 'active', `ESCALATION: ${issue}`);

  setTimeout(() => {
    // Write to ALERTS.md
    const alertEntry = `- [${new Date().toISOString()}] [Jarvis] 🚨 ESCALATION: ${issue}\n`;
    try {
      const alertsContent = fs.readFileSync(PATHS.alertsFile, 'utf-8');
      const updated = alertsContent.replace('## CRITICAL\n', `## CRITICAL\n${alertEntry}`);
      fs.writeFileSync(PATHS.alertsFile, updated);
    } catch (e) {
      fs.writeFileSync(PATHS.alertsFile, `# Alerts\n\n## CRITICAL\n${alertEntry}\n## WARNING\n\n## INFO\n`);
    }

    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `🚨🚨🚨 **ESCALATION TO VIKAS** 🚨🚨🚨\n\n⚠️ Issue: ${issue}\n📢 Priority: CRITICAL\n🕐 Time: ${new Date().toLocaleTimeString()}\n📝 Logged to ALERTS.md\n\n@Vikas — Immediate attention required!`,
      timestamp: new Date().toISOString()
    });

    appendToActivityLog(`[${new Date().toISOString()}] [Jarvis] 🚨 ESCALATION: ${issue} — notified Vikas\n`);
    updateAgentStatus(agentId, 'active', `ESCALATION: ${issue}`);
  }, 1000);
}

// Jarvis help
function showJarvisHelp(agentId) {
  const jarvis = agents[agentId];
  setTimeout(() => {
    broadcast('chat_message', {
      type: 'incoming', agent: agentId, agentName: jarvis.name, agentIcon: jarvis.icon,
      text: `🎖️ **Jarvis — Squad Lead (Natural Language)**\n━━━━━━━━━━━━━━━━━━━━\nJust talk to me naturally. I understand intent, not just commands.\n\n📢 **Standup** — "check in with the team", "morning briefing", "how's everyone doing?"\n👥 **Squad status** — "who's online?", "show me all agents", "roll call"\n🔍 **Triage/assign** — "we need someone to look at the BGP issue", "assign the firewall audit"\n📊 **Reports** — "give me a summary of the week", "what have we completed?"\n🚨 **Escalate** — "the router is down", "we have a critical outage", "BGP is flapping"\n💬 **Anything else** — just describe the situation and I'll figure out the right action\n━━━━━━━━━━━━━━━━━━━━\nManaging ${(jarvis.manages || []).length} agents`,
      timestamp: new Date().toISOString()
    });
    updateAgentStatus(agentId, 'active', 'Help displayed');
  }, 500);
}

// Update agent status and broadcast
function updateAgentStatus(agentId, status, lastAction) {
  if (agents[agentId]) {
    agents[agentId].status = status;
    agents[agentId].lastAction = lastAction;
    agents[agentId].lastUpdated = new Date().toISOString();
    if (status === 'active') {
      agents[agentId].currentTask = lastAction;
    } else {
      agents[agentId].currentTask = null;
    }

    // Save to STATUS.json
    const statusPath = getAgentStatusPath(agentId);
    try {
      fs.writeFileSync(statusPath, JSON.stringify(agents[agentId], null, 2));
    } catch (e) {
      console.error(`[Status] Error saving ${agentId} status:`, e.message);
    }

    broadcast('agent_status', agents[agentId]);
  }
}

// Append to activity log
function appendToActivityLog(entry) {
  try {
    fs.appendFileSync(PATHS.activityLog, entry);
  } catch (e) {
    // File might not exist, create it
    fs.writeFileSync(PATHS.activityLog, entry);
  }
}

// Get tasks from TASKS.md
function getTasks() {
  try {
    if (!fs.existsSync(PATHS.tasksFile)) {
      return { inbox: [], inProgress: [], review: [], done: [], waiting: [] };
    }
    const content = fs.readFileSync(PATHS.tasksFile, 'utf-8');
    return parseTasksFile(content);
  } catch (e) {
    return { inbox: [], inProgress: [], review: [], done: [], waiting: [] };
  }
}

// Parse TASKS.md format
function parseTasksFile(content) {
  const tasks = { inbox: [], inProgress: [], review: [], done: [], waiting: [] };
  let currentSection = null;

  const sectionMap = {
    '## INBOX': 'inbox',
    '## IN PROGRESS': 'inProgress',
    '## REVIEW': 'review',
    '## DONE': 'done',
    '## WAITING': 'waiting'
  };

  content.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();

    // Check for section headers
    for (const [header, section] of Object.entries(sectionMap)) {
      if (trimmed.toUpperCase().startsWith(header.toUpperCase())) {
        currentSection = section;
        return;
      }
    }

    // Parse task lines (- [ ] or - [x] format)
    if (currentSection && (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]'))) {
      const completed = trimmed.startsWith('- [x]');
      const text = trimmed.replace(/^- \[.\]\s*/, '');

      // Extract agent tag if present
      const agentMatch = text.match(/\[([^\]]+)\]/);
      const agent = agentMatch ? agentMatch[1] : null;
      const title = text.replace(/\[[^\]]+\]\s*/, '');

      tasks[currentSection].push({
        id: `task-${idx}`,
        title,
        agent,
        completed,
        raw: trimmed
      });
    }
  });

  return tasks;
}

// Get recent files from all agent directories
function getRecentFiles() {
  try {
    const files = [];
    const skipFiles = new Set(['STATUS.json', 'CLAUDE.md']);

    // Scan each agent's directory for output files
    AGENT_IDS.forEach(agentId => {
      const agentDir = path.join(SQUAD_ROOT, 'agents', agentId);
      if (!fs.existsSync(agentDir)) return;

      // Scan agent root directory
      fs.readdirSync(agentDir).forEach(item => {
        if (skipFiles.has(item) || item.startsWith('.')) return;
        const itemPath = path.join(agentDir, item);
        const stats = fs.statSync(itemPath);

        if (stats.isFile()) {
          files.push({
            name: item,
            path: itemPath,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            agent: agentId,
            type: path.extname(item).slice(1) || 'file'
          });
        } else if (stats.isDirectory()) {
          // Scan subdirectories (e.g., reports/)
          try {
            fs.readdirSync(itemPath).forEach(subFile => {
              const subPath = path.join(itemPath, subFile);
              const subStats = fs.statSync(subPath);
              if (subStats.isFile()) {
                files.push({
                  name: subFile,
                  path: subPath,
                  size: subStats.size,
                  modified: subStats.mtime.toISOString(),
                  agent: agentId,
                  type: path.extname(subFile).slice(1) || 'file'
                });
              }
            });
          } catch (e) { /* skip unreadable dirs */ }
        }
      });
    });

    // Sort by modified date (newest first)
    files.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return files.slice(0, 30);
  } catch (e) {
    return [];
  }
}

// Get recent activity from log
function getRecentActivity() {
  try {
    if (!fs.existsSync(PATHS.activityLog)) {
      return [];
    }
    const content = fs.readFileSync(PATHS.activityLog, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // Parse activity lines
    const activities = lines.map((line, idx) => {
      const match = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)/);
      if (match) {
        return {
          id: `activity-${idx}`,
          timestamp: match[1],
          agent: match[2],
          message: match[3]
        };
      }
      return { id: `activity-${idx}`, timestamp: new Date().toISOString(), agent: 'System', message: line };
    });

    return activities.slice(-50).reverse(); // Last 50, newest first
  } catch (e) {
    return [];
  }
}

// Load agent status from file
function loadAgentStatus(agentId) {
  const statusPath = getAgentStatusPath(agentId);
  try {
    if (fs.existsSync(statusPath)) {
      const data = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      if (agents[agentId]) {
        agents[agentId] = {
          ...agents[agentId],
          status: data.status || 'idle',
          currentTask: data.currentTask || null,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          lastAction: data.lastAction || 'No recent activity'
        };
      }
    }
  } catch (e) {
    console.error(`[Status] Error loading ${agentId} status:`, e.message);
  }
}

// ============ DEBATE SYSTEM ============
let activeDebateId = null;

// Start a new debate thread
function startDebate(initiatorId, topic) {
  const initiator = agents[initiatorId];
  if (!initiator) return;

  const debateId = ++debateIdCounter;
  const timestamp = new Date().toISOString();

  // Determine relevant agents based on topic keywords
  const topicLower = topic.toLowerCase();
  const participants = [initiatorId];

  // Auto-invite based on topic
  if (topicLower.match(/firewall|acl|policy|fortios|fortigate/i)) participants.push('firewall-pro');
  if (topicLower.match(/security|cve|vuln|threat|advisory/i)) participants.push('sentinel');
  if (topicLower.match(/config|backup|compliance|change|upgrade/i)) participants.push('config-keeper');
  if (topicLower.match(/load.?bal|f5|vip|pool/i)) participants.push('loadbal-pro');
  if (topicLower.match(/route|bgp|ospf|convergence/i)) participants.push('router-expert');
  if (topicLower.match(/monitor|alert|threshold|splunk/i)) participants.push('monitor-eye');
  if (topicLower.match(/incident|outage|down/i)) participants.push('incident-handler');
  if (topicLower.match(/doc|runbook|procedure/i)) participants.push('doc-writer');
  if (topicLower.match(/network|device|ssh|check/i)) participants.push('netops');

  // Always include jarvis as moderator
  if (!participants.includes('jarvis')) participants.push('jarvis');

  // Ensure at least 3 participants (add netops/sentinel if needed)
  if (participants.length < 3) {
    if (!participants.includes('netops')) participants.push('netops');
    if (participants.length < 3 && !participants.includes('sentinel')) participants.push('sentinel');
  }

  // Deduplicate
  const uniqueParticipants = [...new Set(participants)];

  const thread = {
    id: debateId,
    topic,
    initiator: initiatorId,
    initiatorName: initiator.name,
    participants: uniqueParticipants,
    messages: [],
    status: 'open',
    created: timestamp,
    updated: timestamp
  };

  debateThreads.push(thread);
  activeDebateId = debateId;

  // Broadcast new debate
  broadcast('debate_new', thread);

  // Jarvis announces the debate
  const participantNames = uniqueParticipants.map(id => `${agents[id]?.icon || '🤖'} ${agents[id]?.name || id}`).join(', ');
  broadcast('chat_message', {
    type: 'incoming',
    agent: 'jarvis',
    agentName: 'Jarvis',
    agentIcon: '🎖️',
    text: `⚔️ **DEBATE INITIATED**\n📋 Topic: "${topic}"\n👥 Participants: ${participantNames}\n\nI'll moderate this discussion. Agents, share your perspectives.`,
    timestamp
  });

  appendToActivityLog(`[${timestamp}] [Jarvis] Debate started: "${topic}" with ${uniqueParticipants.length} participants\n`);

  // Add initial message from initiator
  thread.messages.push({
    id: 1,
    agent: initiatorId,
    agentName: initiator.name,
    agentIcon: initiator.icon,
    stance: 'propose',
    text: `I'd like to discuss: ${topic}`,
    timestamp
  });

  // Simulate agents responding with staggered delays
  let delay = 2000;
  const respondingAgents = uniqueParticipants.filter(id => id !== initiatorId);

  respondingAgents.forEach((agentId, idx) => {
    const agent = agents[agentId];
    if (!agent) return;

    setTimeout(() => {
      const response = generateDebateResponse(agentId, topic, idx, respondingAgents.length);
      const msgTimestamp = new Date().toISOString();

      thread.messages.push({
        id: thread.messages.length + 1,
        agent: agentId,
        agentName: agent.name,
        agentIcon: agent.icon,
        stance: response.stance,
        text: response.text,
        timestamp: msgTimestamp
      });
      thread.updated = msgTimestamp;

      broadcast('debate_message', {
        debateId,
        message: thread.messages[thread.messages.length - 1]
      });

      broadcast('chat_message', {
        type: 'incoming',
        agent: agentId,
        agentName: agent.name,
        agentIcon: agent.icon,
        text: `⚔️ [Debate] ${getStanceBadge(response.stance)} ${response.text}`,
        timestamp: msgTimestamp
      });

      updateAgentStatus(agentId, 'active', `Debating: ${topic}`);
    }, delay);

    delay += 1500 + Math.random() * 1500;
  });

  // Jarvis summarizes after all agents respond
  setTimeout(() => {
    if (thread.status !== 'open') return;

    const summary = generateDebateSummary(thread);
    const summaryTimestamp = new Date().toISOString();

    thread.messages.push({
      id: thread.messages.length + 1,
      agent: 'jarvis',
      agentName: 'Jarvis',
      agentIcon: '🎖️',
      stance: 'summary',
      text: summary,
      timestamp: summaryTimestamp
    });
    thread.updated = summaryTimestamp;

    broadcast('debate_message', {
      debateId,
      message: thread.messages[thread.messages.length - 1]
    });

    broadcast('chat_message', {
      type: 'incoming',
      agent: 'jarvis',
      agentName: 'Jarvis',
      agentIcon: '🎖️',
      text: `⚔️ [Debate Summary] ${summary}\n\nType "resolve" to close this debate, or continue discussing.`,
      timestamp: summaryTimestamp
    });
  }, delay + 2000);
}

// Generate debate response based on agent specialty
function generateDebateResponse(agentId, topic, idx, totalAgents) {
  const stances = ['agree', 'refute', 'alternative'];
  // First agent more likely to agree, later ones more likely to challenge
  const stanceWeights = idx === 0 ? [0.5, 0.2, 0.3] : idx === totalAgents - 1 ? [0.2, 0.5, 0.3] : [0.3, 0.3, 0.4];
  const rand = Math.random();
  let stance;
  if (rand < stanceWeights[0]) stance = 'agree';
  else if (rand < stanceWeights[0] + stanceWeights[1]) stance = 'refute';
  else stance = 'alternative';

  const topicLower = topic.toLowerCase();
  const responses = {
    'sentinel': {
      agree: `From a security standpoint, I support this. Our CVE monitoring shows this aligns with current threat mitigation best practices.`,
      refute: `I have concerns — our latest threat intel suggests this could introduce new attack vectors. We need a thorough security assessment first.`,
      alternative: `Instead, I'd recommend a phased approach with security gates at each stage. Let me run a vulnerability scan before we proceed.`
    },
    'firewall-pro': {
      agree: `The firewall policies can accommodate this. I've reviewed the rule base and see no conflicts.`,
      refute: `Hold on — this could break existing NAT rules and VPN tunnels. We need to test in a sandbox first.`,
      alternative: `What if we implement this with a staged rollout? I can create temporary policies to test the impact.`
    },
    'config-keeper': {
      agree: `Config compliance checks pass. I have backups ready in case we need to rollback.`,
      refute: `Our compliance framework flags this as a risk. The config drift from baseline would exceed our thresholds.`,
      alternative: `I suggest we take a config snapshot first, then implement with automated rollback triggers if drift exceeds 15%.`
    },
    'netops': {
      agree: `Network health looks good for this change. Device metrics are within acceptable ranges.`,
      refute: `Current device utilization is too high for this change window. CPU on core switches is already at 78%.`,
      alternative: `Let me run pre-checks on all affected devices first. We should establish a baseline before making changes.`
    },
    'loadbal-pro': {
      agree: `F5 pools and VIPs are healthy. Load distribution can handle the proposed changes.`,
      refute: `This could impact our SSL offloading and pool persistence. I recommend against proceeding without load testing.`,
      alternative: `We could use traffic mirroring to test the impact before full deployment. I'll set up a shadow pool.`
    },
    'router-expert': {
      agree: `BGP adjacencies and OSPF areas are stable. Routing tables can accommodate this.`,
      refute: `Route convergence time would increase unacceptably. We risk BGP flapping during the transition.`,
      alternative: `Let's use BGP communities to implement this gradually across AS boundaries. Safer convergence.`
    },
    'monitor-eye': {
      agree: `Monitoring baselines are stable. I'll set up additional alerting for the change window.`,
      refute: `Current alert trends show increasing anomalies. We should investigate before making more changes.`,
      alternative: `I propose we instrument this with enhanced monitoring first — custom Splunk dashboards for the change window.`
    },
    'incident-handler': {
      agree: `No active incidents. Runbook is ready. I'll prepare rollback procedures.`,
      refute: `We had a similar change cause an outage 3 weeks ago. The RCA findings suggest we're not ready for this.`,
      alternative: `Let's add this to the change calendar with a proper CAB review. I'll draft the rollback plan.`
    },
    'doc-writer': {
      agree: `Documentation is up to date. I'll prepare the change log and notification.`,
      refute: `The runbook for this procedure hasn't been updated since Q2. We need to refresh it before proceeding.`,
      alternative: `I'll create a decision matrix document so we can objectively evaluate all options before committing.`
    },
    'jarvis': {
      agree: `As Squad Lead, I concur. The team has the capacity and the risk is manageable.`,
      refute: `Let's slow down — I'm seeing conflicting signals from the team. We need alignment before proceeding.`,
      alternative: `I suggest we break this into smaller tasks and assign them across the squad for parallel evaluation.`
    }
  };

  const agentResponses = responses[agentId] || {
    agree: 'I agree with this approach.',
    refute: 'I have reservations about this.',
    alternative: 'I propose an alternative approach.'
  };

  return { stance, text: agentResponses[stance] };
}

function getStanceBadge(stance) {
  switch (stance) {
    case 'agree': return '🟢 AGREE:';
    case 'refute': return '🔴 REFUTE:';
    case 'alternative': return '🟡 ALTERNATIVE:';
    case 'propose': return '💡 PROPOSE:';
    case 'summary': return '📊 SUMMARY:';
    default: return '';
  }
}

function generateDebateSummary(thread) {
  const agrees = thread.messages.filter(m => m.stance === 'agree').length;
  const refutes = thread.messages.filter(m => m.stance === 'refute').length;
  const alternatives = thread.messages.filter(m => m.stance === 'alternative').length;
  const total = agrees + refutes + alternatives;

  let consensus;
  if (total === 0) {
    consensus = 'No positions taken yet.';
  } else if (agrees > refutes && agrees >= alternatives) {
    consensus = `Leaning toward consensus (${agrees}/${total} agree). Ready to proceed with caution.`;
  } else if (refutes > agrees) {
    consensus = `Significant opposition (${refutes}/${total} refute). Recommend further analysis before proceeding.`;
  } else {
    consensus = `Mixed opinions with alternatives proposed (${alternatives}/${total}). Consider hybrid approach.`;
  }

  return `📊 **Debate Status: "${thread.topic}"**\n🟢 Agree: ${agrees} | 🔴 Refute: ${refutes} | 🟡 Alternatives: ${alternatives}\n📋 ${consensus}`;
}

// Add a message to an active debate
function addDebateMessage(agentId, stance, text) {
  const thread = debateThreads.find(t => t.id === activeDebateId);
  if (!thread || thread.status !== 'open') return;

  const agent = agents[agentId];
  if (!agent) return;

  const timestamp = new Date().toISOString();
  const message = {
    id: thread.messages.length + 1,
    agent: agentId,
    agentName: agent.name,
    agentIcon: agent.icon,
    stance,
    text,
    timestamp
  };

  thread.messages.push(message);
  thread.updated = timestamp;

  // Add agent to participants if not already
  if (!thread.participants.includes(agentId)) {
    thread.participants.push(agentId);
  }

  broadcast('debate_message', { debateId: activeDebateId, message });

  broadcast('chat_message', {
    type: 'incoming',
    agent: agentId,
    agentName: agent.name,
    agentIcon: agent.icon,
    text: `⚔️ [Debate] ${getStanceBadge(stance)} ${text}`,
    timestamp
  });

  appendToActivityLog(`[${timestamp}] [${agent.name}] Debate ${stance}: ${text}\n`);
}

// Resolve/close a debate
function resolveDebate(agentId) {
  const thread = debateThreads.find(t => t.id === activeDebateId);
  if (!thread) return;

  const agent = agents[agentId];
  const timestamp = new Date().toISOString();

  thread.status = 'resolved';
  thread.updated = timestamp;

  const summary = generateDebateSummary(thread);
  const resolution = {
    id: thread.messages.length + 1,
    agent: 'jarvis',
    agentName: 'Jarvis',
    agentIcon: '🎖️',
    stance: 'summary',
    text: `✅ **DEBATE RESOLVED**\n${summary}\n\nDebate closed by ${agent ? agent.name : 'System'}.`,
    timestamp
  };

  thread.messages.push(resolution);

  broadcast('debate_resolved', { debateId: activeDebateId, thread });
  broadcast('debate_message', { debateId: activeDebateId, message: resolution });

  broadcast('chat_message', {
    type: 'incoming',
    agent: 'jarvis',
    agentName: 'Jarvis',
    agentIcon: '🎖️',
    text: resolution.text,
    timestamp
  });

  appendToActivityLog(`[${timestamp}] [Jarvis] Debate resolved: "${thread.topic}"\n`);

  // Reset active debate
  activeDebateId = null;

  // Return participants to idle
  thread.participants.forEach(id => {
    if (id !== 'jarvis') updateAgentStatus(id, 'idle', 'Debate concluded');
  });
}

// API Endpoints
app.get('/api/agents', (req, res) => {
  // Refresh status before responding
  Object.keys(agents).forEach(loadAgentStatus);
  res.json(Object.values(agents));
});

app.get('/api/tasks', (req, res) => {
  res.json(getTasks());
});

// Save tasks to TASKS.md
app.post('/api/tasks', (req, res) => {
  try {
    const tasks = req.body;
    const content = generateTasksMarkdown(tasks);
    fs.writeFileSync(PATHS.tasksFile, content);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate TASKS.md content from tasks object
function generateTasksMarkdown(tasks) {
  const formatTask = (task) => {
    const checkbox = task.completed ? '[x]' : '[ ]';
    const agent = task.agent ? `[${task.agent}] ` : '';
    return `- ${checkbox} ${agent}${task.title}`;
  };

  let md = '# Agent Task Board\n\n';

  md += '## INBOX\n';
  (tasks.inbox || []).forEach(t => md += formatTask(t) + '\n');
  md += '\n';

  md += '## IN PROGRESS\n';
  (tasks.inProgress || []).forEach(t => md += formatTask(t) + '\n');
  md += '\n';

  md += '## REVIEW\n';
  (tasks.review || []).forEach(t => md += formatTask(t) + '\n');
  md += '\n';

  md += '## DONE\n';
  (tasks.done || []).forEach(t => md += formatTask({...t, completed: true}) + '\n');
  md += '\n';

  md += '## WAITING\n';
  (tasks.waiting || []).forEach(t => md += formatTask(t) + '\n');

  return md;
}

// Add a task to the board programmatically
function addTaskToBoard(column, task) {
  const tasks = getTasks();

  if (!tasks[column]) {
    tasks[column] = [];
  }

  const newTask = {
    id: `task-${Date.now()}`,
    title: task.title,
    agent: task.agent || null,
    completed: task.completed || false
  };

  tasks[column].push(newTask);

  // Save to file
  const content = generateTasksMarkdown(tasks);
  fs.writeFileSync(PATHS.tasksFile, content);

  // Broadcast update
  broadcast('tasks_updated', tasks);

  console.log(`[Tasks] Added task to ${column}: ${task.title}`);
  return newTask;
}

// Move a task between columns
function moveTaskOnBoard(taskTitle, fromColumn, toColumn) {
  const tasks = getTasks();

  // Find task in source column
  const fromTasks = tasks[fromColumn] || [];
  const taskIndex = fromTasks.findIndex(t => t.title === taskTitle);

  if (taskIndex === -1) {
    console.log(`[Tasks] Task not found in ${fromColumn}: ${taskTitle}`);
    return false;
  }

  // Remove from source
  const [task] = fromTasks.splice(taskIndex, 1);

  // Update completion status
  task.completed = toColumn === 'done';

  // Add to destination
  if (!tasks[toColumn]) {
    tasks[toColumn] = [];
  }
  tasks[toColumn].push(task);

  // Save to file
  const content = generateTasksMarkdown(tasks);
  fs.writeFileSync(PATHS.tasksFile, content);

  // Broadcast update
  broadcast('tasks_updated', tasks);

  console.log(`[Tasks] Moved task from ${fromColumn} to ${toColumn}: ${taskTitle}`);

  // When a task completes:
  // 1. Clear the mention badge for the assigned agent
  // 2. Auto-remove from done column after 4 seconds
  if (toColumn === 'done') {
    // Clear mention count for the agent who completed the task
    if (task.agent) {
      const agentId = AGENT_IDS.find(id => {
        const a = agents[id];
        return a && a.name && a.name.toLowerCase() === task.agent.toLowerCase();
      });
      if (agentId && mentionCounts[agentId] > 0) {
        mentionCounts[agentId] = 0;
        broadcast('agents_updated', {
          agents: Object.values(agents),
          mentionCounts: { ...mentionCounts }
        });
        console.log(`[Tasks] Cleared mention badge for ${task.agent}`);
      }
    }

    // Auto-remove from done after 4 seconds so board stays clean
    setTimeout(() => {
      const latest = getTasks();
      const doneIdx = (latest.done || []).findIndex(t => t.title === taskTitle);
      if (doneIdx !== -1) {
        latest.done.splice(doneIdx, 1);
        const updated = generateTasksMarkdown(latest);
        fs.writeFileSync(PATHS.tasksFile, updated);
        broadcast('tasks_updated', latest);
        console.log(`[Tasks] Auto-removed completed task from board: ${taskTitle}`);
      }
    }, 4000);
  }

  return true;
}

// Create a task from a command
function createTaskFromCommand(agentId, command, column = 'inbox') {
  const agent = agents[agentId];
  return addTaskToBoard(column, {
    title: command,
    agent: agent ? agent.name : agentId,
    completed: false
  });
}

// Pause / Resume endpoints
app.post('/api/pause', (req, res) => {
  isPaused = true;
  broadcast('pause_state', { paused: true });
  appendToActivityLog(`[${new Date().toISOString()}] [Dashboard] ⏸ System PAUSED by Vikas\n`);
  res.json({ success: true, paused: true });
});

app.post('/api/resume', (req, res) => {
  isPaused = false;
  broadcast('pause_state', { paused: false });
  appendToActivityLog(`[${new Date().toISOString()}] [Dashboard] ▶ System RESUMED by Vikas\n`);
  res.json({ success: true, paused: false });
});

// Debate API endpoints
app.get('/api/debates', (req, res) => {
  res.json(debateThreads);
});

app.post('/api/debates', (req, res) => {
  const { initiator, topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  startDebate(initiator || 'jarvis', topic);
  res.json({ success: true, debateId: debateIdCounter });
});

app.get('/api/debates/:id', (req, res) => {
  const thread = debateThreads.find(t => t.id === parseInt(req.params.id));
  if (!thread) return res.status(404).json({ error: 'Debate not found' });
  res.json(thread);
});

// Mention counts endpoint
app.get('/api/mentions', (req, res) => {
  res.json(mentionCounts);
});

app.get('/api/files', (req, res) => {
  res.json(getRecentFiles());
});

app.get('/api/activity', (req, res) => {
  res.json(getRecentActivity());
});

app.post('/api/command', (req, res) => {
  const { agent, command } = req.body;
  if (!agent || !command) {
    return res.status(400).json({ error: 'Agent and command required' });
  }
  handleCommand({ agent, command });
  res.json({ success: true, message: 'Command queued' });
});

// File download endpoint
app.get('/api/files/download/:filename', (req, res) => {
  const filename = req.params.filename;
  // Search across all agent directories for the file
  for (const agentId of AGENT_IDS) {
    const agentDir = path.join(SQUAD_ROOT, 'agents', agentId);
    // Check agent root
    let filePath = path.join(agentDir, filename);
    if (fs.existsSync(filePath)) return res.download(filePath);
    // Check reports subfolder
    filePath = path.join(agentDir, 'reports', filename);
    if (fs.existsSync(filePath)) return res.download(filePath);
  }
  res.status(404).json({ error: 'File not found' });
});

// File browser - list directory contents
app.get('/api/browse', (req, res) => {
  const requestedPath = req.query.path || SQUAD_ROOT;

  // Security: Ensure path is within squad workspace
  const normalizedPath = path.normalize(requestedPath);
  if (!normalizedPath.startsWith(SQUAD_ROOT)) {
    return res.status(403).json({ error: 'Access denied - path outside workspace' });
  }

  try {
    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stats = fs.statSync(normalizedPath);

    if (stats.isFile()) {
      // Return file content
      const ext = path.extname(normalizedPath).toLowerCase();
      const textExts = ['.md', '.txt', '.json', '.yaml', '.yml', '.log', '.csv', '.py', '.js', '.sh', '.bat', '.cfg', '.conf', '.ini'];

      if (textExts.includes(ext)) {
        const content = fs.readFileSync(normalizedPath, 'utf-8');
        return res.json({
          type: 'file',
          path: normalizedPath,
          name: path.basename(normalizedPath),
          content: content.slice(0, 50000), // Limit to 50KB
          size: stats.size,
          modified: stats.mtime.toISOString()
        });
      } else {
        return res.json({
          type: 'file',
          path: normalizedPath,
          name: path.basename(normalizedPath),
          content: '[Binary file - click Download to view]',
          size: stats.size,
          modified: stats.mtime.toISOString(),
          binary: true
        });
      }
    }

    // List directory contents
    const items = fs.readdirSync(normalizedPath).map(name => {
      const itemPath = path.join(normalizedPath, name);
      try {
        const itemStats = fs.statSync(itemPath);
        return {
          name,
          path: itemPath,
          isDirectory: itemStats.isDirectory(),
          size: itemStats.size,
          modified: itemStats.mtime.toISOString()
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Sort: directories first, then files, alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      type: 'directory',
      path: normalizedPath,
      name: path.basename(normalizedPath),
      parent: normalizedPath !== SQUAD_ROOT ? path.dirname(normalizedPath) : null,
      items,
      root: SQUAD_ROOT
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download any file from workspace
app.get('/api/browse/download', (req, res) => {
  const requestedPath = req.query.path;

  if (!requestedPath) {
    return res.status(400).json({ error: 'Path required' });
  }

  const normalizedPath = path.normalize(requestedPath);
  if (!normalizedPath.startsWith(SQUAD_ROOT)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
    res.download(normalizedPath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Activity log position tracker
let lastActivitySize = 0;

// File watcher setup
function setupFileWatcher() {
  const watchPaths = [
    SQUAD_ROOT
  ];

  const watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  });

  watcher.on('add', (filePath) => {
    console.log(`[Watcher] File added: ${filePath}`);
    broadcast('file_added', {
      path: filePath,
      name: path.basename(filePath),
      type: path.extname(filePath).slice(1) || 'file'
    });
    broadcast('files_updated', getRecentFiles());
  });

  watcher.on('change', (filePath) => {
    console.log(`[Watcher] File changed: ${filePath}`);

    const filename = path.basename(filePath);

    // Handle specific file changes
    if (filename === 'TASKS.md') {
      broadcast('tasks_updated', getTasks());
    } else if (filename === 'ACTIVITY_LOG.md') {
      // Stream only new lines
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > lastActivitySize) {
          const fd = fs.openSync(filePath, 'r');
          const buffer = Buffer.alloc(stats.size - lastActivitySize);
          fs.readSync(fd, buffer, 0, buffer.length, lastActivitySize);
          fs.closeSync(fd);

          const newContent = buffer.toString('utf-8');
          const newLines = newContent.split('\n').filter(line => line.trim());

          newLines.forEach(line => {
            const match = line.match(/\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)/);
            if (match) {
              broadcast('activity_new', {
                id: `activity-${Date.now()}`,
                timestamp: match[1],
                agent: match[2],
                message: match[3]
              });
            }
          });

          lastActivitySize = stats.size;
        }
      } catch (e) {
        console.error('[Watcher] Error reading activity log:', e.message);
      }
    } else if (filename === 'STATUS.json') {
      // Determine which agent's status changed by checking directory
      const agentId = AGENT_IDS.find(id => filePath.includes(path.sep + id + path.sep) || filePath.includes('/' + id + '/'));
      if (agentId && agents[agentId]) {
        loadAgentStatus(agentId);
        broadcast('agent_status', agents[agentId]);
      }
    } else if (filename === 'ALERTS.md') {
      broadcast('alerts_updated', { timestamp: new Date().toISOString() });
    }
  });

  watcher.on('unlink', (filePath) => {
    console.log(`[Watcher] File removed: ${filePath}`);
    broadcast('file_removed', { path: filePath, name: path.basename(filePath) });
    broadcast('files_updated', getRecentFiles());
  });

  watcher.on('error', (error) => {
    console.error('[Watcher] Error:', error);
  });

  console.log('[Watcher] Watching for file changes...');
}

// Periodic status refresh
function startStatusRefresh() {
  setInterval(() => {
    if (isPaused) return;
    Object.keys(agents).forEach(agentId => {
      loadAgentStatus(agentId);
    });
    broadcast('agents_updated', Object.values(agents));
  }, 5000); // Every 5 seconds
}

// Initialize activity log size tracker
function initActivityTracker() {
  try {
    if (fs.existsSync(PATHS.activityLog)) {
      lastActivitySize = fs.statSync(PATHS.activityLog).size;
    }
  } catch (e) {
    lastActivitySize = 0;
  }
}

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       🚀 MISSION CONTROL DASHBOARD - LIVE SERVER 🚀       ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Dashboard: http://localhost:${PORT}                          ║`);
  console.log(`║  WebSocket: ws://localhost:${PORT}                            ║`);
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║  Status: LIVE                                             ║');
  console.log('║  File Watcher: ACTIVE                                     ║');
  console.log('║  Auto-refresh: Every 5 seconds                            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  initActivityTracker();
  setupFileWatcher();
  startStatusRefresh();
});
