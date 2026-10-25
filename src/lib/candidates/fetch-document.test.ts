import { describe, expect, it } from "vitest";
import { fetchLinkedPdf } from "./fetch-document";

// The guard runs before any request leaves, so none of these touch the network.
describe("fetchLinkedPdf refuses addresses an applicant should not choose", () => {
  it.each([
    "http://example.com/cv.pdf",
    "https://127.0.0.1/cv.pdf",
    "https://10.0.0.5/cv.pdf",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.1/cv.pdf",
    "https://[::1]/cv.pdf",
    "https://example.com:8443/cv.pdf",
    "https://user:pw@example.com/cv.pdf",
  ])("%s", async (url) => {
    await expect(fetchLinkedPdf(url)).rejects.toThrow(/public/);
  });
});
