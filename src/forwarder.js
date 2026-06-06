import { fetchNewImapEmails } from "./imap-client.js";
import { buildForwardedMessage, sendSmtpMail } from "./smtp-client.js";
import { StateStore } from "./state-store.js";

export async function runOnce(config) {
  const store = new StateStore(config.stateFile);
  const state = await store.load();
  const previousLastUid = state.lastUid;
  let stateChanged = false;
  const fetchResult = await fetchNewImapEmails(
    config.source,
    previousLastUid,
    config.networkTimeoutMs,
  );

  if (!state.initialized && config.forward.firstRunMode === "checkpoint") {
    state.initialized = true;
    state.lastUid = fetchResult.maxUid;
    state.forwardedUids = [];
    await store.save(state);
    return {
      mode: "checkpoint",
      fetched: fetchResult.emails.length,
      totalNew: fetchResult.totalNew,
      stats: fetchResult.stats,
      forwarded: 0,
      failed: 0,
      forwardedItems: [],
      failures: [],
      lastUid: state.lastUid,
    };
  }

  let forwarded = 0;
  const forwardedItems = [];
  const failures = [];
  const forwardedSet = new Set(state.forwardedUids);

  for (const email of fetchResult.emails) {
    if (forwardedSet.has(email.uid)) continue;

    const message = buildForwardedMessage(email, config);
    try {
      await sendSmtpMail(config.target, message, config.networkTimeoutMs, config.forward.heloName);
      forwardedSet.add(email.uid);
      state.forwardedUids = [...forwardedSet];
      await store.save(state);
      stateChanged = false;
      forwarded += 1;
      forwardedItems.push({ uid: email.uid, subject: email.subject });
    } catch (error) {
      failures.push({ uid: email.uid, error: error.message });
    }
  }

  if (!state.initialized) {
    state.initialized = true;
    stateChanged = true;
  }
  if (failures.length === 0 && fetchResult.fetchedMaxUid > previousLastUid) {
    state.lastUid = fetchResult.fetchedMaxUid;
    state.forwardedUids = [];
    stateChanged = true;
  } else {
    const nextForwardedUids = [...forwardedSet].filter((uid) => uid > state.lastUid);
    if (!sameNumberArray(state.forwardedUids, nextForwardedUids)) {
      state.forwardedUids = nextForwardedUids;
      stateChanged = true;
    }
  }

  if (stateChanged) await store.save(state);

  return {
    mode: "forward",
    fetched: fetchResult.emails.length,
    totalNew: fetchResult.totalNew,
    stats: fetchResult.stats,
    forwarded,
    forwardedItems,
    failed: failures.length,
    failures,
    lastUid: state.lastUid,
  };
}

function sameNumberArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
