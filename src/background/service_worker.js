/*
 * service_worker.js — eklenti simgesine basınca yan paneli açar,
 * klavye kısayollarını panele iletir.
 */
'use strict';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) { /* setPanelBehavior zaten açmış olabilir */ }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (e) {}
  // Panel açıkken komutu dinler; kapalıysa sessizce yutulur.
  chrome.runtime.sendMessage({ channel: 'chessmove', type: 'command', command, tabId: tab.id })
    .catch(() => {});
});
