// Run as a DevTools function at 375px, 1024px and desktop on the local demo.
// Synthetic UI only; never dispatches task mutations or accesses a live account.
async () => {
  const wait = () => new Promise(resolve => setTimeout(resolve, 700));
  const check = (condition, message) => { if (!condition) throw Error(message); };
  await wait(); // Allow the shared responsive shell to settle after viewport emulation.
  const tab = document.querySelector('#calendar-edge-launcher');
  const mobile = matchMedia('(max-width: 760px)').matches;
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, y: r.y, height: r.height }; };
  const shown = element => !!element && element.getAttribute('aria-hidden') !== 'true' && element.getBoundingClientRect().width > 0;
  check(tab && tab.getAttribute('aria-label')?.includes('Calendar'), 'Calendar edge tab missing accessible name');
  check(tab.closest('.rail,.topbar') && document.querySelectorAll('#calendar-edge-launcher').length === 1, 'Calendar tab duplicated or placed in page content');
  const shortcut = document.querySelector('.calendar-shortcut');
  check(shortcut && Math.abs(rect(shortcut).y - rect(tab).y) <= 2, 'Calendar tab not aligned with navigation shortcut');
  for (const drawer of document.querySelectorAll('.edge-drawer.is-open')) drawer.querySelector('button[aria-label^="Close"]')?.click();
  await wait();
  if (tab.getAttribute('aria-expanded') === 'true') { tab.click(); await wait(); }
  window.scrollTo(0, 0);
  const route = location.hash;
  const closedTab = rect(tab);
  check(closedTab.height >= 44 && closedTab.x >= 0 && closedTab.right <= innerWidth, 'Closed Calendar tab clipped or undersized');
  if (!mobile) {
    check(closedTab.x === 56 && closedTab.width >= 36, 'Calendar tab must extend outside compact rail');
    check(getComputedStyle(tab).borderTopWidth === '2px', 'Attached Calendar tab outline missing');
  }
  check(tab.getAttribute('aria-controls') === (mobile ? 'calendar-quick-drawer' : 'quest-sidebar'), 'Calendar tab targets wrong side panel');
  tab.focus();
  tab.click();
  await wait();
  const calendar = document.querySelector(mobile ? '#calendar-quick-drawer' : '#quest-sidebar');
  check(shown(calendar), 'Calendar panel did not open');
  check(calendar.querySelector('.deck-cal-grid'), 'Opened sidebar lacks Calendar content');
  const panel = rect(calendar), openTab = rect(tab);
  check(panel.x >= 0 && panel.right <= innerWidth + 1, 'Calendar outside viewport');
  if (mobile) check(panel.x === 0 && panel.width === innerWidth, 'Mobile Calendar is not full width');
  else check(panel.x === 56 && Math.abs(panel.right - openTab.x) < 1, 'Open Calendar tab not attached to panel edge');
  check(document.documentElement.scrollWidth <= innerWidth, 'Calendar causes horizontal overflow');
  const bell = document.querySelector('[aria-controls="notifications-edge-drawer"]');
  if (mobile) { calendar.querySelector('button[aria-label^="Close"]').click(); await wait(); }
  bell.click(); await wait();
  const notifications = document.querySelector('#notifications-edge-drawer');
  check(shown(notifications), 'Notifications did not open');
  const rightPanel = rect(notifications);
  check(Math.abs(rightPanel.right - innerWidth) <= 16, 'Notifications moved to Calendar side');
  if (!mobile) check(rightPanel.x > panel.x, 'Left and right panels swapped');
  notifications.querySelector('button[aria-label^="Close"]').click(); await wait();
  check(tab.getAttribute('aria-expanded') === String(!mobile), 'Prior Calendar state not restored');
  if (!mobile) { check(shown(calendar), 'Restored Calendar hidden'); tab.click(); await wait(); }
  bell.click(); await wait();
  notifications.querySelector('button[aria-label^="Close"]').click(); await wait();
  check(tab.getAttribute('aria-expanded') === 'false', 'Originally closed Calendar unexpectedly opened');
  check(location.hash === route, 'Panel sequence changed route');
  check(document.documentElement.scrollWidth <= innerWidth, 'Panel sequence causes horizontal overflow');
  return { viewport: innerWidth, closedTab, calendar: panel, adjacentTab: openTab, notifications: rightPanel, routePreserved: true, restoration: true, pass: true };
}
