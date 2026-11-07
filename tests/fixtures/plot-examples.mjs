// 확인용 plot 예시(그림 확인 페이지와 시험이 함께 씀). { name, palette, spec }
export const EXAMPLES = [
  { name: "sample-velocity", palette: "teal", spec: `x: 0 .. 5
y: 0 .. 12
v: y = 2x + 2            "v = 2t + 2"
fill: v, 0 .. 4
slope: v, 1 .. 3
point: (0, 2)            "v₀"
w: 60
` },
  { name: "spec-format", palette: "teal", spec: `x: -1 .. 4
y: -1 .. 9
f: y = 2x + 1            "y=2x+1"
g: y = x^2 / 2
fill: f, 0 .. 3
slope: f, 1 .. 2
point: (0, 1)            "y절편"
w: 70
` },
  { name: "linear-grid", palette: "teal", spec: `x: -4 .. 4
y: -4 .. 4
grid: on
f: y = x            "y = x"
g: y = -x/2 + 1     "y = −x/2 + 1"
point: (2/3*2, 2/3*2) "교점"
` },
  { name: "quadratic-between", palette: "teal", spec: `x: -1 .. 4
y: -1 .. 10
f: y = x^2         "y = x²"
g: y = 2x + 3      "y = 2x + 3"
fill: f, g, -1 .. 3
point: (-1, 1)
point: (3, 9)      "(3, 9)"
` },
  { name: "tan", palette: "teal", spec: `x: -2pi .. 2pi
y: -4 .. 4
grid: on
t: y = tan(x)      "y = tan x"
s: y = sin x       "y = sin x"
` },
  { name: "sin-cos", palette: "red", spec: `x: 0 .. 2pi
y: -1.5 .. 1.5
a: y = sin x       "y = sin x"
b: y = cos x       "y = cos x"
fill: a, b, pi/4 .. 5pi/4
w: 80
` },
  { name: "kinematics-red", palette: "red", spec: `x: 0 .. 6
y: -4 .. 8
xlabel: t
ylabel: v
v: y = 2t - 4      "v = v_0 + at"
fill: v, 0 .. 6
slope: v, 3 .. 5
point: (0, -4)     "v_0"
` },
  { name: "decreasing-slope", palette: "red", spec: `x: 0 .. 10
y: 0 .. 20
x1: y = 18 - 2x    "x = x_0 − vt"
slope: x1, 2 .. 6
fill: x1, 0 .. 4
` },
  { name: "error-case", palette: "teal", spec: `x: 0 .. 5
f: y = 2x +
g: y = foo(x)
h: y = 3x - 1      "h"
fill: z, 0 .. 2
point: (9, 9)      "밖"
w: abc
` },
  { name: "four-curves", palette: "teal", spec: `x: -3 .. 3
y: -3 .. 9
a: y = x^2          "a"
b: y = x^2/2        "b"
c: y = 2x           "c"
d: y = abs(x) - 1   "d"
grid: on
` },
  { name: "sqrt-ln", palette: "teal", spec: `x: -1 .. 8
y: -2 .. 4
f: y = sqrt(x)     "√x"
g: y = ln x        "ln x"
w: 50
` },
  { name: "inverse", palette: "teal", spec: `x: -4 .. 4
y: -4 .. 4
f: y = 1/x         "y = 1/x"
w: 50
` },
];
