import { experienceJson, getExperienceConfig, isSameOriginExperienceRequest } from "@/lib/experience-api.server";

export function GET(request: Request) {
  if (!isSameOriginExperienceRequest(request)) return experienceJson({ error: "Request not allowed." }, 403);
  return experienceJson(getExperienceConfig());
}
