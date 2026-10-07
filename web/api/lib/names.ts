import { drop, record, records } from "./store";

/** The name an owner gave one of their builds, which takes the place of the one Holo gave it. */
export interface ProjectName {
  id: string;
  name: string;
  /** In ms since the epoch. */
  updated: number;
}

/** Names are `<shelf><id>/<milliseconds>.json`, per owner. */
const shelf = (owner: string) => `names/${encodeURIComponent(owner)}/`;

export const projectName = async (owner: string, id: string) =>
  (await records<ProjectName>(shelf(owner), id))[0] ?? null;

export const projectNames = (owner: string) => records<ProjectName>(shelf(owner));

export async function saveProjectName(owner: string, id: string, name: string): Promise<ProjectName> {
  const named = { id, name, updated: Date.now() };
  await record(shelf(owner), named);
  return named;
}

export const forgetName = (owner: string, id: string) => drop(`${shelf(owner)}${id}/`);
