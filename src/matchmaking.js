export const MATCH_WAIT_MS=180000;
export function formatMatchTime(milliseconds){
  const seconds=Math.ceil(Math.max(0,Math.min(MATCH_WAIT_MS,Number(milliseconds)||0))/1000);
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
