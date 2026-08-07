// Ad unit IDs issued by the Apps in Toss developer console.
//
// Kept in one file so swapping a unit (or pointing at the test units while
// debugging) never means grepping through components. The test IDs the docs
// publish are `ait-ad-test-rewarded-id` and `ait-ad-test-banner-id`; they only
// render inside the Toss sandbox and are the right thing to substitute here
// when checking layout without burning real impressions.

/** Full-screen rewarded ad — grants one extra AI diary run per day. */
export const REWARDED_AD_GROUP_ID = "ait.v2.live.b7f333e3c6324cc5";

/** Inline banner shown on the preview and calendar views. */
export const BANNER_AD_GROUP_ID = "ait.v2.live.f777b418dd604163";
