export type DiscussionSelection = { id: string | null; epoch: number; version: number };
export function acceptDiscussionResponse(active: DiscussionSelection, request: Pick<DiscussionSelection, "id" | "epoch">, version: number) {
  return active.id === request.id && active.epoch === request.epoch && version >= active.version;
}
