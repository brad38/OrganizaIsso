// Cards pendentes sempre primeiro, independentemente de prazo vencido.
// Dentro de cada estado: prazos ativos mais urgentes, vencidos ao final.
export function compareActivityDisplayOrder(a, b, doneIds, getReferenceDue, getDueInfo) {
  const doneA = doneIds.has(a.id);
  const doneB = doneIds.has(b.id);
  if (doneA !== doneB) return doneA ? 1 : -1;

  const dueA = getReferenceDue(a);
  const dueB = getReferenceDue(b);
  const expiredA = getDueInfo(dueA).status === "expired";
  const expiredB = getDueInfo(dueB).status === "expired";
  if (expiredA !== expiredB) return expiredA ? 1 : -1;

  const timeA = new Date(dueA).getTime();
  const timeB = new Date(dueB).getTime();
  const aValid = Number.isFinite(timeA);
  const bValid = Number.isFinite(timeB);
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (!aValid) return a.id.localeCompare(b.id);

  const order = expiredA ? timeB - timeA : timeA - timeB;
  return order || a.id.localeCompare(b.id);
}
