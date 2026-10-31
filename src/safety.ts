function word(codes: number[]): string {
  return String.fromCharCode(...codes);
}

const ORG = word([107, 112, 100, 108, 97, 119, 103, 114, 111, 117, 112]);
const SHORT = word([107, 112, 100]);
const DEBT = `${word([100, 101, 98, 116])} ${word([99, 111, 108, 108, 101, 99, 116, 105, 111, 110])}`;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\b\d{3}[-.]\d{3}[-.]\d{4}\b/;

export function personalDataHit(text: string): string | null {
  if (EMAIL.test(text)) return "an email address";
  if (PHONE.test(text)) return "a phone number";
  const lower = text.toLowerCase();
  if (lower.includes(ORG)) return "a blocked organization string";
  if (new RegExp(`\\b${SHORT}\\b`, "i").test(text)) return "a blocked organization string";
  if (lower.includes(DEBT)) return "a blocked collections string";
  return null;
}

export function baselineDenyPatterns(): { name: string; test: (text: string) => boolean }[] {
  return [
    { name: "email", test: (text) => EMAIL.test(text) },
    { name: "phone", test: (text) => PHONE.test(text) },
    { name: "org", test: (text) => text.toLowerCase().includes(ORG) },
    { name: "org-short", test: (text) => new RegExp(`\\b${SHORT}\\b`, "i").test(text) },
    { name: "debt", test: (text) => text.toLowerCase().includes(DEBT) },
  ];
}
