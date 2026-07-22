// The WLED entity-naming convention, owned in one place: N segments on a
// device produce N+1 HA entities — the group/whole-device entity (no
// suffix) plus one per segment (suffixed "_segment_<n>"). Anything that
// needs to reason about that convention imports these helpers instead of
// hardcoding the suffix, so the string exists exactly once and the
// base/segment logic isn't duplicated across mixins/sync.js and mixins/segments.js.

const SEGMENT_SUFFIX = '_segment_';

// Is this a per-segment entity (as opposed to the whole-device group)?
export const isSegmentEntity = (id) => id.includes(SEGMENT_SUFFIX);

// The device's group (base) entity id: a segment id with its suffix
// stripped; a group id is returned unchanged. So baseEntity() maps both
// the group and every one of its segments to the same base — handy for
// "does this entity belong to my device?" checks.
export const baseEntity = (id) => (isSegmentEntity(id) ? id.split(SEGMENT_SUFFIX)[0] : id);

// Build the entity id for segment `n` of the given base (group) entity.
export const segmentEntity = (base, segmentNumber) => `${base}${SEGMENT_SUFFIX}${segmentNumber}`;
