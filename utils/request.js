'use strict';

// request.js — builds the request the drafter needs, from a profile and YOUR profile. Pure: no DOM, no network.
// Used by the side panel AND by the on-page composer, so both always ask for exactly the same thing.
//   Request.shared(sender, profile, { overlapOff, spotlightOff })
//        → { overlaps: kept overlaps (kind,label,detail,line), all: every overlap (with ids), sender: contact-free summary | null,
//            spotlight: the one relevant project/role | null }
//   Request.generateData({ profile, settings, purpose, tone, format, seed, shared, forceFree }) → payload for the `generateMessage` action
// "Overlaps" = what you and they have in common; "spotlight" = the ONE project or role of yours that fits their field.

(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./overlap.js') : root.Overlap,
    typeof module === 'object' && module.exports ? require('./spotlight.js') : root.Spotlight);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Request = api;
})(typeof self !== 'undefined' ? self : this, function (Overlap, Spotlight) {

  const hasResumeInfo = (sp) => !!sp && !!((sp.schools || []).length || (sp.employers || []).length || (sp.skills || []).length || (sp.projects || []).length ||
    (sp.experience || []).length || (sp.education || []).length || sp.city || sp.goal);

  const pack = ({ kind, label, detail, line }) => ({ kind, label, detail, line });

  // the one project/role to mention; an employer already used as a shared point is not repeated
  function spotlightFor(sender, profile, keptOverlaps) {
    if (!profile || !hasResumeInfo(sender)) return null;
    const excl = (keptOverlaps || []).filter(o => o.kind === 'employer').map(o => o.label);
    return Spotlight.spotlight(sender, profile, { excludeCompanies: excl });
  }

  function shared(sender, profile, { overlapOff = [], spotlightOff = false } = {}) {
    const off = overlapOff instanceof Set ? overlapOff : new Set(overlapOff);
    const all = hasResumeInfo(sender) && profile ? Overlap.findOverlaps(sender, profile) : [];
    const kept = all.filter(o => !off.has(o.id));
    const spot = spotlightFor(sender, profile, kept);
    return {
      overlaps: kept.map(pack),
      all,
      sender: hasResumeInfo(sender) ? Overlap.senderSummary(sender) : null,
      spotlight: spotlightOff ? null : spot
    };
  }

  // exactly what the background `generateMessage` action expects (the key and the resume text are never part of it)
  function generateData({ profile, settings = {}, purpose = 'Networking', tone = 'Neutral', format = 'note', seed = 0, shared: sh = null, forceFree = false } = {}) {
    const s = sh || { overlaps: [], sender: null, spotlight: null };
    return {
      profileData: profile,
      settings: { userName: settings.userName || '', userBio: settings.userBio || '' },
      messageType: purpose, tone, format: format === 'message' ? 'message' : 'note', seed,
      overlaps: s.overlaps, sender: s.sender, spotlight: s.spotlight,
      ...(forceFree ? { forceFree: true } : {})
    };
  }

  return { hasResumeInfo, spotlightFor, shared, generateData };
});
