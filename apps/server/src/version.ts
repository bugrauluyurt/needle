import pkg from "../package.json" with { type: "json" };

export const VERSION = pkg.version;
export const HOMEPAGE = pkg.homepage;
export const USER_AGENT = `Needle/${VERSION} ( ${HOMEPAGE} )`;
