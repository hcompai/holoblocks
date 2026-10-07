import { privateConfigured, privateDelete, privateFiles, privateRead, privateWrite } from "./privateStore";

/** The name an owner gave one of their builds, which takes the place of the one Holo gave it. */
export interface ProjectName {
  id: string;
  name: string;
  /** In ms since the epoch. */
  updated: number;
}

/** Names can title private builds, so they are `names/<owner>/<id>.json` in the private store. */
const shelf = (owner: string) => `names/${encodeURIComponent(owner)}/`;
const path = (owner: string, id: string) => `${shelf(owner)}${id}.json`;

async function read(path: string): Promise<ProjectName | null> {
  const response = await privateRead(path);
  return response && ((await response.json()) as ProjectName);
}

export const projectName = async (owner: string, id: string) => (privateConfigured() ? read(path(owner, id)) : null);

export async function projectNames(owner: string): Promise<ProjectName[]> {
  if (!privateConfigured()) return [];
  const names = await Promise.all((await privateFiles(shelf(owner))).map((b) => read(b.pathname)));
  return names.filter((n): n is ProjectName => n !== null);
}

export async function saveProjectName(owner: string, id: string, name: string): Promise<ProjectName> {
  const named = { id, name, updated: Date.now() };
  await privateWrite(path(owner, id), JSON.stringify(named), "application/json");
  return named;
}

export const forgetName = async (owner: string, id: string) => {
  if (privateConfigured()) await privateDelete([path(owner, id)]);
};
