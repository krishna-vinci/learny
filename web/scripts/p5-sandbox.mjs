/** p5 2.3.4 unconditionally registers motion sensors denied by our opaque iframe.
 * Disable only that registration in the local bundle; keep every sandbox/CSP restriction.
 * Fail the build if an upgrade changes the hook so it cannot silently restore console noise.
 */
export function disableP5Motion(source) {
  const events = '["deviceorientation","devicemotion"]';
  if (source.split(events).length !== 2) throw new Error("p5 motion hook changed; review the sandbox patch");
  return source.replace(events, "[]");
}
