'use strict';
'require baseclass';

/*
 * What the command center says: one status, one sentence and the one action worth taking next.
 * Pure: it takes the counts the view already has and returns an action id that the view maps to a handler.
 */

function action(id, label, button) {
	return { id: id, label: label, button: button };
}

function result(tone, label, summary, next) {
	return { tone: tone, pill: tone == 'ready' ? 'mwan4-online' : 'mwan4-warning', label: label, summary: summary, action: next };
}

function setupState(progress) {
	if (!progress.hasLinks)
		return result('setup', _('Setup needed'), _('No WAN links are set up yet, so all traffic uses the router\'s normal routing.'),
			action('addLink', _('Add first WAN link'), 'cbi-button-add'));

	if (!progress.enabledLinkCount)
		return result('setup', _('Setup needed'), _('All WAN links are disabled. Enable one so traffic can use it.'),
			action('reviewLinks', _('Review WAN links'), 'cbi-button-edit'));

	if (!progress.hasRouting)
		return result('setup', _('Routing needed'), _('Your WAN links are ready. Choose how traffic that no rule matches should leave.'),
			action('chooseRouting', _('Choose default routing'), 'cbi-button-apply'));

	if (!progress.hasRules)
		return result('setup', _('Default routing needed'), _('Default routing is missing, so traffic may bypass mwan4. Choose how it should leave.'),
			action('chooseRouting', _('Choose default routing'), 'cbi-button-apply'));

	return null;
}

function restartOrCheck(operator) {
	return operator ? action('restart', _('Restart mwan4'), 'cbi-button-action') : action('refresh', _('Check again'), 'cbi-button-neutral');
}

function runtimeState(live, warnings, operator) {
	if (warnings)
		return result('warning', _('Needs attention'), operator
			? _('mwan4 is set up but not fully running, so failover and routing rules may not apply. Restart it to fix this.')
			: _('mwan4 is set up but not fully running, so failover and routing rules may not apply. Ask an operator to restart it.'), restartOrCheck(operator));

	if (!live.total)
		return result('warning', _('Starting'), _('Waiting for the first link status from mwan4. If this stays empty, restart it.'), restartOrCheck(operator));

	if (live.offline)
		return result('warning', _('Degraded'), _('%d of %d WAN links are offline, so there is less backup. Traffic avoids them.').format(live.offline, live.total),
			action('reviewLinks', _('Review WAN links'), 'cbi-button-edit'));

	return null;
}

/* progress: setupProgress(); live: { online, offline, total } of the enabled links; warnings: number of runtime warnings */
function commandState(progress, live, warnings, operator) {
	return setupState(progress) || runtimeState(live, warnings, operator) ||
		result('ready', _('Ready'), _('Everything is working: all %d WAN links are online.').format(live.total), action('addRule', _('Add routing rule'), 'cbi-button-add'));
}

return baseclass.extend({
	commandState: commandState
});
