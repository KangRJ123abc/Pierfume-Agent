/**
 * CAS 号校验位算法(零依赖,纯函数)。
 * 由 validate-data.mjs 与 material-admin-core.mjs 共用。
 *
 * 算法:取去掉校验位的数字(从右往左),依次乘以 1,2,3,... 求和,校验位 = 和 mod 10。
 * 例:5989-27-5 → 基数字符串 "598927",从右到左 7*1+2*2+9*3+8*4+9*5+5*6=145,145%10=5 ✓
 */

export function casCheckDigitValid(cas) {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
  if (!m) return false;
  const base = (m[1] + m[2]).split("").reverse().join("");
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (i + 1) * Number(base[i]);
  return sum % 10 === Number(m[3]);
}
