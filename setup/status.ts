function formatUiLine(
  step: string,
  fields: Record<string, string | number | boolean>,
): string | null {
  const st = String(fields.STATUS ?? '');
  const ok = st === 'success' || st === 'skipped';

  switch (step) {
    case 'CHECK_ENVIRONMENT':
      return ok
        ? '✓ This computer looks ready (Docker and project files).'
        : null;
    case 'TIMEZONE':
      return ok ? '✓ Your time zone is saved for TVClaw.' : null;
    case 'CONFIGURE_MOUNTS':
      if (st === 'skipped') {
        return '✓ Folder-access settings already exist — left unchanged.';
      }
      if (!ok) {
        return '✗ Folder-access settings could not be saved — see logs/setup.log';
      }
      return '✓ Folder-access settings are in place.';
    case 'SETUP_CONTAINER':
      return ok
        ? '✓ The secure helper image is built and working (Docker).'
        : '✗ Could not finish the Docker helper — see logs/setup.log';
    case 'SETUP_SERVICE':
      return ok
        ? '✓ TVClaw will keep running in the background (starts when you sign in).'
        : '✗ Background app setup had a problem — see logs/setup.log';
    case 'VERIFY': {
      const cr = String(fields.CONTAINER_RUNTIME ?? '');
      if (cr === 'none') {
        return '✗ Docker (or your container tool) is not ready — TVClaw needs it.';
      }
      if (st === 'success') {
        return '✓ Quick health check: all set.';
      }
      if (st === 'in_progress') {
        return '✓ Machine setup is ready — continue with AI, WhatsApp, and the TV app below.';
      }
      return '✓ Continuing setup…';
    }
    case 'REGISTER_CHANNEL':
      if (!ok) {
        return '✗ Could not register the WhatsApp group — see logs/setup.log';
      }
      return '✓ WhatsApp group is registered with TVClaw.';
    case 'SYNC_GROUPS':
      return ok || st === 'skipped' ? '✓ WhatsApp groups are in sync.' : null;
    case 'BOOTSTRAP':
      return ok ? '✓ Node packages and build tools are ready.' : null;
    default:
      return ok ? `✓ Step ${step} done.` : null;
  }
}

export function emitStatus(
  step: string,
  fields: Record<string, string | number | boolean>,
): void {
  if (process.env.TVCLAW_SETUP_UI === '1') {
    const line = formatUiLine(step, fields);
    if (line) {
      console.log(line);
    }
    return;
  }

  const lines = [`=== NANOCLAW SETUP: ${step} ===`];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('=== END ===');
  console.log(lines.join('\n'));
}
