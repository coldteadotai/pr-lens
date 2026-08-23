/**
 * The measurements of the validated prototype, in one place. These are the
 * design system: change a number here and every diagram moves with it.
 */
export const DIAGRAM_MARGIN = 16;

export const LANE_TOP = 44;
export const LANE_HEADER_BASELINE = 68;
export const LANE_PADDING_X = 16;
export const LANE_GAP = 20;
export const LANE_BOTTOM_PADDING = 20;

/**
 * Every lane is the same width, and that width is a constant rather than
 * anything derived from what the lanes hold.
 *
 * A lane's width decides where the lane after it starts, so a width drawn
 * from content couples every column to the contents of the ones before it:
 * adding one node with a long name to the first lane would slide every card
 * in every later lane sideways, which is exactly the teleport a reviewer
 * comparing two pushes must never be shown. The cost is that a lane holding
 * something narrow is wider than it needs to be. Stability is worth more.
 *
 * Sized so that two cards sharing a row still each get a readable width.
 */
export const LANE_CONTENT_WIDTH = 372;
export const LANE_RADIUS = 12;
export const LANE_LABEL_SIZE = 10;
export const LANE_LABEL_TRACKING = 0.12;

export const CONTENT_TOP = 92;
export const ROW_GAP = 52;

export const CARD_RADIUS = 10;
export const CARD_GAP_X = 12;
export const CARD_HEIGHT = 52;
export const CARD_HEIGHT_WITH_SUBTITLE = 62;
export const CARD_PADDING_X = 14;

export const ICON_CHIP_SIZE = 26;
export const ICON_CHIP_GAP = 10;
export const ICON_CHIP_RADIUS = 7;
/** Below this a card's title starts a size down, to keep its room. */
export const ICON_MIN_CARD_WIDTH = 200;

export const TITLE_SIZE = 13;
export const TITLE_SIZE_SMALL = 11.5;

/**
 * How a title that overruns its card gives way. Cards cannot widen — their
 * width is a constant so that a rename moves nothing — so a name longer than
 * the run it was given steps down in half-points until it fits, and is cut
 * only once it would go below the floor. A reader can read a name set half a
 * point smaller; a name with its tail missing is a different name.
 *
 * Half-points because the step has to be coarse enough that two cards side by
 * side do not look randomly sized, and fine enough that one step is usually
 * the whole of it.
 */
export const TITLE_SIZE_MIN = 10.5;
export const TITLE_SIZE_STEP = 0.5;

export const SUBTITLE_SIZE = 9.5;

export const BADGE_HEIGHT = 16;
export const BADGE_PADDING_X = 9;
export const BADGE_TEXT_SIZE = 8.5;
export const BADGE_TRACKING = 0.06;
export const BADGE_GAP = 6;
export const BADGE_RADIUS = 8;
/** How far the badge row rides above the top edge of the card it labels. */
export const BADGE_RISE = 8;

export const PILL_HEIGHT = 15;
export const PILL_PADDING_X = 8;
export const PILL_TEXT_SIZE = 9.5;
/** Two label pills never sit closer than this, in either direction. */
export const PILL_CLEARANCE = 2;

/**
 * Routes travel in the gaps of the grid: vertical corridors beside lanes and
 * horizontal bands between rows. Both gaps are physically 52px across — lane
 * padding + lane gap + lane padding one way, ROW_GAP the other — and a track
 * keeps this clearance from the cards on either side, leaving 40px of room.
 */
export const TRACK_CLEARANCE = 6;
/**
 * Neighbouring tracks in one gap sit this far apart at most; when a gap
 * carries more traffic than the room allows, the pitch shrinks to fit. An
 * added route therefore nudges its gap-mates proportionately — an accepted
 * trade, and one that never moves a card.
 */
export const TRACK_PITCH_MAX = 16;
/**
 * And never closer than this: below it, parallel runs stop reading as
 * separate lines. A gap asked to carry more traffic than the floor allows
 * does not compress further — it widens instead, corridors pushing the lanes
 * beside them apart and row gaps pushing the rows, in proportion to the
 * traffic and to nothing else.
 */
export const TRACK_PITCH_MIN = 10;

/** Step between neighbouring arrow ports along one card face. */
export const PORT_PITCH = 16;
/** Ports keep clear of the card's rounded corners. */
export const PORT_INSET = 14;

/**
 * A turn's bend radius comes from the shorter of its two legs, capped here.
 * Deriving it from the longer leg balloons a route with one short leg and one
 * long one — the shape every corridor run has — clear out of its corridor.
 */
export const BEND_RADIUS_MAX = 34;

/** One turn of the travelling pulse, and of the staggered train. */
export const PULSE_DURATION = 1.6;
export const HERO_PULSE_DURATION = 2.1;
export const HERO_PULSE_COUNT = 3;

/**
 * A sequence animates one step at a time, in order, because that is the one
 * thing a sequence has to say. Each pulse owns a slot of the cycle outright
 * and crosses its arrow for the whole of it, so the drawing always has
 * exactly one dot in flight — the next arrow lights as the last dot lands.
 *
 * This is how long one crossing takes when the flow is short enough to
 * afford it: brisk enough to read as travelling, slow enough to follow.
 */
export const FLOW_STEP_TRAVEL = 1.4;
/**
 * A whole sequence should play through in one sitting. Past this the steps
 * share the ceiling instead, which speeds up a long flow rather than asking
 * a reader to wait a minute for its last arrow.
 */
export const FLOW_CYCLE_MAX = 16;
/** How much of its own slot a pulse spends fading in, and again fading out. */
export const FLOW_PULSE_RAMP = 0.08;
/** More repeats than this and the arrows stop reading as separate calls. */
export const FLOW_MAX_PULSES_PER_MESSAGE = 3;
