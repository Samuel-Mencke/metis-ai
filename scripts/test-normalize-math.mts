import { normalizeMath } from "../lib/math.ts";

const sample = `[ 3= \\frac{\\Gamma(4)}{\\Gamma(3)} \\cdot \\frac12\\int_{0}^{\\pi}\\sin(x),dx \\cdot \\det \\begin{pmatrix} 1&0\\\\ 0&1 \\end{pmatrix} \\cdot \\sum_{k=0}^{\\infty}\\frac1{2^{k+1}} \\cdot \\frac1e\\lim_{n\\to\\infty}\\left(1+\\frac1n\\right)^n ]

Because every factor except the first is (1), and

[ \\frac{\\Gamma(4)}{\\Gamma(3)}=\\frac{3!}{2!}=3. ]
`;

const out = normalizeMath(sample);
const count = (out.match(/\$\$/g) || []).length;
console.log(out);
console.log("$$ count:", count, "blocks:", count / 2);
if (count < 4) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
