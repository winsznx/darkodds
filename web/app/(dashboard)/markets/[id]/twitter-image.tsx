/// Twitter card for /markets/[id]. Same render as opengraph-image at the
/// same dimensions (1200×630 fits both `summary_large_image` and the OG
/// spec). Re-exporting keeps the two routes in lockstep — change the OG
/// render and Twitter follows automatically.
export {default, alt, size, contentType} from "./opengraph-image";
