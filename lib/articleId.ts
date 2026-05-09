function urlSlug(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

function toBase64Url(s: string): string {
  let b64: string;
  if (typeof btoa === "function") {
    b64 = btoa(unescape(encodeURIComponent(s)));
  } else {
    b64 = Buffer.from(s, "utf8").toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function articleId(u: string): string {
  return toBase64Url(urlSlug(u)).slice(0, 64);
}
