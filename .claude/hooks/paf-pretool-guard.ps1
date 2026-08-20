$ErrorActionPreference = "Stop"

function Emit-Decision([string]$Decision, [string]$Reason) {
    @{
        hookSpecificOutput = @{
            hookEventName = "PreToolUse"
            permissionDecision = $Decision
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Depth 6 -Compress
}

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $event = $raw | ConvertFrom-Json
    $tool = [string]$event.tool_name
    $inputData = $event.tool_input

    if ($tool -in @("Bash", "PowerShell")) {
        $command = [string]$inputData.command
        $normalized = $command.ToLowerInvariant()

        $denyPatterns = @(
            'git\s+push\s+.*--force',
            'git\s+reset\s+--hard',
            'rm\s+-rf\s+(/|\*|\.)',
            'remove-item\s+.*-recurse.*-force',
            'terraform\s+destroy',
            'drop\s+database',
            'drop\s+table',
            'truncate\s+table',
            '\.dropdatabase\s*\(',
            '\.drop\s*\(',
            'delete\s+from\s+\S+\s*;?\s*$'
        )

        foreach ($pattern in $denyPatterns) {
            if ($normalized -match $pattern) {
                Emit-Decision "deny" "PAF bloqueou comando destrutivo ou irreversível."
                exit 0
            }
        }

        $askPatterns = @(
            'git\s+push',
            'docker\s+push',
            'terraform\s+apply',
            'kubectl\s+(apply|patch|rollout|scale|delete)',
            '\b(prod|production)\b',
            'insert\s+into',
            'update\s+\S+\s+set',
            'delete\s+from',
            'pix.withdraw',
            'pay-boleto',
            'boletos.pay-boleto'
        )

        foreach ($pattern in $askPatterns) {
            if ($normalized -match $pattern) {
                Emit-Decision "ask" "PAF exige confirmação humana para ação remota, produção, mutação de dados ou publicação externa."
                exit 0
            }
        }

        exit 0
    }

    if ($tool -in @("Write", "Edit")) {
        $filePath = [string]$inputData.file_path
        $normalizedPath = $filePath.Replace('\','/').ToLowerInvariant()

        $denyPaths = @(
            '/.env',
            '/secrets/',
            '.pem',
            '.p12',
            '.pfx',
            '/id_rsa',
            '/id_ed25519'
        )
        foreach ($pattern in $denyPaths) {
            if ($normalizedPath.Contains($pattern)) {
                Emit-Decision "deny" "PAF bloqueia escrita em arquivo de segredo."
                exit 0
            }
        }

        $protectedPaths = @(
            '/claude.md',
            '/.claude/settings.json',
            '/.claude/agents/',
            '/.claude/hooks/',
            '/.claude/governance/livrepay-constitution.md'
        )
        foreach ($pattern in $protectedPaths) {
            if ($normalizedPath.Contains($pattern)) {
                Emit-Decision "ask" "Arquivo protegido de governança ou agente. Confirmação humana necessária."
                exit 0
            }
        }
    }

    exit 0
}
catch {
    Emit-Decision "ask" "PAF não conseguiu validar a ação. Confirmação humana necessária."
    exit 0
}
