import { Syne } from "next/font/google";

/**
 * Display font for the ENIGMA wordmark/logo. Syne is a distinctive
 * geometric-humanist face that reads as a brand mark rather than body
 * text. Self-hosted by next/font at build time.
 */
export const enigmaFont = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
});
