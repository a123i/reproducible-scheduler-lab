// Unicode code-point tie breaking, independent of locale and input file order.
export function compareIds(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

// No random or clock input enters the kernel.
export function compareTasks(left, right) {
  if (left.release !== right.release) return left.release - right.release;
  return compareIds(left.id, right.id);
}
