import { apiRequest } from "./api";

export const PROFILE_URL_LIMIT = 512;

type Details = { name: string; role: string; summary: string; experience: string; skills: string; contact: string };
type ResumeSource = { kind: "pdf" | "docx" | "text"; label: string; stored: boolean };
export type ApprovedEvidence = { kind: "github" | "linkedin"; label: string; text: string; url: string | null };
export type Profile = {
  version: number;
  details: Details;
  resume: ResumeSource | null;
  evidence: ApprovedEvidence[];
  github_url: string | null;
  linkedin_url: string | null;
};

export function profileRequest<T>(path = "", options?: RequestInit): Promise<T> {
  return apiRequest<T>("/api/profile" + path, options);
}
