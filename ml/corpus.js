const { makeRng } = require("../public/lib/mlp");

// Text sources for synthetic training screenshots: source code in the languages
// typically used for lab practicals, and the kind of text those programs print.

const LANGS = {
  c: {
    keywords: ["int", "float", "char", "void", "return", "if", "else", "for", "while", "do", "break", "continue", "struct", "switch", "case", "default", "sizeof", "const", "unsigned", "long", "double"],
    types: ["FILE", "size_t"],
    lineComment: "//", blockComment: ["/*", "*/"], preproc: true, braces: true,
  },
  cpp: {
    keywords: ["int", "float", "char", "void", "return", "if", "else", "for", "while", "class", "public", "private", "protected", "using", "namespace", "new", "delete", "const", "bool", "true", "false", "virtual", "template", "typename", "this", "double"],
    types: ["string", "vector", "cout", "cin", "endl", "std"],
    lineComment: "//", blockComment: ["/*", "*/"], preproc: true, braces: true,
  },
  java: {
    keywords: ["public", "private", "protected", "static", "void", "int", "double", "boolean", "class", "new", "return", "if", "else", "for", "while", "try", "catch", "throw", "throws", "extends", "implements", "import", "package", "final", "this", "super", "null", "true", "false", "interface"],
    types: ["String", "System", "Scanner", "ArrayList", "List", "Integer", "Exception", "Math", "HashMap"],
    lineComment: "//", blockComment: ["/*", "*/"], preproc: false, braces: true,
  },
  python: {
    keywords: ["def", "return", "if", "elif", "else", "for", "while", "in", "import", "from", "class", "self", "True", "False", "None", "try", "except", "with", "as", "lambda", "and", "or", "not", "pass", "break"],
    types: ["print", "range", "len", "input", "int", "str", "list", "dict", "open", "sum"],
    lineComment: "#", blockComment: null, preproc: false, braces: false,
  },
  js: {
    keywords: ["function", "const", "let", "var", "return", "if", "else", "for", "while", "new", "class", "this", "true", "false", "null", "async", "await", "import", "export", "from", "of", "in", "typeof"],
    types: ["console", "document", "Math", "Array", "JSON", "window", "Promise"],
    lineComment: "//", blockComment: ["/*", "*/"], preproc: false, braces: true,
  },
  php: {
    keywords: ["function", "echo", "return", "if", "else", "foreach", "as", "while", "for", "class", "public", "new", "array", "isset", "true", "false"],
    types: ["mysqli_connect", "mysqli_query", "strlen", "count"],
    lineComment: "//", blockComment: ["/*", "*/"], preproc: false, braces: true,
  },
  sql: {
    keywords: ["SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "CREATE", "TABLE", "PRIMARY", "KEY", "UPDATE", "SET", "DELETE", "JOIN", "ON", "GROUP", "BY", "ORDER", "NOT", "NULL", "AND", "OR", "VARCHAR", "INT", "DATE", "AS", "COUNT"],
    types: [],
    lineComment: "--", blockComment: ["/*", "*/"], preproc: false, braces: false,
  },
  html: { keywords: [], types: [], lineComment: null, blockComment: ["<!--", "-->"], preproc: false, braces: false, markup: true },
};

const SNIPPETS = {
  c: `#include <stdio.h>

// Program to find factorial of a number
int factorial(int n) {
    if (n <= 1)
        return 1;
    return n * factorial(n - 1);
}

int main() {
    int num;
    printf("Enter a number: ");
    scanf("%d", &num);
    if (num < 0) {
        printf("Factorial is not defined for negative numbers\\n");
    } else {
        printf("Factorial of %d = %d\\n", num, factorial(num));
    }
    return 0;
}`,
  cpp: `#include <iostream>
using namespace std;

class Rectangle {
private:
    int length, breadth;
public:
    Rectangle(int l, int b) {
        length = l;
        breadth = b;
    }
    int area() {
        return length * breadth;
    }
};

int main() {
    int l, b;
    cout << "Enter length and breadth: ";
    cin >> l >> b;
    Rectangle r(l, b);
    cout << "Area = " << r.area() << endl;
    return 0;
}`,
  java: `import java.util.Scanner;

public class BankAccount {
    private double balance;

    public BankAccount(double initial) {
        this.balance = initial;
    }

    public void deposit(double amount) {
        if (amount > 0) {
            balance += amount;
        }
    }

    public void withdraw(double amount) throws Exception {
        if (amount > balance) {
            throw new Exception("Insufficient balance");
        }
        balance -= amount;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        BankAccount acc = new BankAccount(1000);
        System.out.print("Enter amount to deposit: ");
        acc.deposit(sc.nextDouble());
        System.out.println("Balance: " + acc.balance);
    }
}`,
  python: `import math

# Practical: operations on a list
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(math.sqrt(n)) + 1):
        if n % i == 0:
            return False
    return True

numbers = [int(x) for x in input("Enter numbers: ").split()]
primes = [n for n in numbers if is_prime(n)]
print("Prime numbers:", primes)
print("Sum:", sum(numbers))
print("Average:", sum(numbers) / len(numbers))`,
  js: `// Simple calculator using DOM events
const display = document.getElementById("display");
let expression = "";

function press(value) {
  expression += value;
  display.value = expression;
}

function calculate() {
  try {
    const result = eval(expression);
    display.value = result;
    expression = String(result);
  } catch (err) {
    display.value = "Error";
    expression = "";
  }
}

document.querySelectorAll(".btn").forEach((btn) => {
  btn.addEventListener("click", () => press(btn.dataset.value));
});`,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Registration Form</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Student Registration</h1>
  <form action="submit.php" method="post">
    <label for="name">Name:</label>
    <input type="text" id="name" name="name" required>
    <label for="email">Email:</label>
    <input type="email" id="email" name="email">
    <select name="branch">
      <option>Computer</option>
      <option>IT</option>
    </select>
    <button type="submit">Register</button>
  </form>
</body>
</html>`,
  sql: `-- Create and query the student table
CREATE TABLE student (
    roll_no INT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    branch VARCHAR(20),
    marks INT
);

INSERT INTO student VALUES (1, 'Aarav', 'CE', 85);
INSERT INTO student VALUES (2, 'Diya', 'IT', 91);
INSERT INTO student VALUES (3, 'Kabir', 'CE', 78);

SELECT branch, COUNT(*) AS total, AVG(marks) AS average
FROM student
WHERE marks > 70
GROUP BY branch
ORDER BY average DESC;`,
  php: `<?php
$conn = mysqli_connect("localhost", "root", "", "college");
if (!$conn) {
    die("Connection failed: " . mysqli_connect_error());
}

$result = mysqli_query($conn, "SELECT * FROM student");
echo "<table border='1'>";
while ($row = mysqli_fetch_assoc($result)) {
    echo "<tr>";
    echo "<td>" . $row['roll_no'] . "</td>";
    echo "<td>" . $row['name'] . "</td>";
    echo "</tr>";
}
echo "</table>";
mysqli_close($conn);
?>`,
};

const NOUNS = ["num", "count", "total", "arr", "list", "node", "head", "temp", "result", "value", "key", "item", "index", "sum", "avg", "marks", "student", "name", "data", "size", "top", "stack", "queue", "front", "rear", "left", "right", "root", "matrix", "row", "col", "balance", "amount", "price", "qty", "str", "ch", "flag", "max", "min", "pos", "low", "high", "mid", "graph", "visited", "dist", "weight"];
const VERBS = ["insert", "delete", "display", "search", "sort", "push", "pop", "enqueue", "dequeue", "calculate", "find", "print", "read", "update", "reverse", "merge", "swap", "traverse", "check", "add", "remove", "compute", "get", "set", "init"];
const CLASSES = ["Student", "Stack", "Queue", "Node", "Employee", "Account", "Shape", "Circle", "Matrix", "LinkedList", "Graph", "Library", "Book", "Complex", "Vehicle"];
const WORDS = ["the", "number", "element", "value", "array", "list", "is", "of", "sorted", "found", "at", "position", "total", "enter", "result", "student", "marks", "average", "record", "inserted", "successfully", "deleted", "stack", "queue", "empty", "full", "item", "name", "balance", "your", "choice", "invalid", "input", "prime", "factorial", "sum", "matrix", "string", "reversed", "vowels", "count", "largest", "smallest", "employee", "salary"];

const cap = (s) => s[0].toUpperCase() + s.slice(1);
function ident(rng) {
  return rng.chance(0.5) ? rng.pick(NOUNS) : rng.pick(VERBS) + cap(rng.pick(NOUNS));
}
function sentence(rng, lo = 2, hi = 6) {
  const n = rng.int(lo, hi);
  const w = [];
  for (let i = 0; i < n; i++) w.push(rng.pick(WORDS));
  return cap(w.join(" "));
}

// ---------- procedural code ----------

function cStyleStatement(rng, lang) {
  const v = ident(rng);
  const printers = {
    c: () => `printf("${sentence(rng)}: %d\\n", ${v});`,
    cpp: () => `cout << "${sentence(rng)}: " << ${v} << endl;`,
    java: () => `System.out.println("${sentence(rng)}: " + ${v});`,
    js: () => `console.log("${sentence(rng)}:", ${v});`,
    php: () => `echo "${sentence(rng)}: " . $${v} . "<br>";`,
  };
  const decl = { c: "int", cpp: rng.pick(["int", "double", "string", "auto"]), java: rng.pick(["int", "double", "String"]), js: rng.pick(["let", "const"]), php: "" }[lang];
  const pv = lang === "php" ? "$" + v : v;
  const choices = [
    () => `${decl ? decl + " " : ""}${pv} = ${rng.int(0, 100)};`,
    () => `${pv} = ${pv} + ${ident(rng)}[${rng.pick(["i", "j", "k"])}];`,
    () => `${pv}++;`,
    () => printers[lang](),
    () => `${ident(rng)}(${pv}, ${rng.int(1, 9)});`,
    () => `return ${pv};`,
    () => `${pv} = ${ident(rng)} * ${rng.int(2, 10)} / ${rng.int(2, 5)};`,
  ];
  return rng.pick(choices)();
}

function genBlockCode(rng, lang, depth, out, ind) {
  const n = rng.int(1, depth > 1 ? 3 : 5);
  const pad = ind.repeat(depth);
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (depth < 4 && r < 0.3) {
      const head = rng.pick([
        `for (int i = 0; i < ${ident(rng)}; i++)`,
        `while (${ident(rng)} != ${rng.int(0, 5)})`,
        `if (${ident(rng)} > ${ident(rng)})`,
        `if (${ident(rng)} == ${rng.int(0, 9)})`,
      ]).replace("int i", lang === "js" ? "let i" : lang === "php" ? "$i" : "int i");
      out.push(pad + head + " {");
      genBlockCode(rng, lang, depth + 1, out, ind);
      out.push(pad + "}");
      if (head.startsWith("if") && rng.chance(0.35)) {
        out[out.length - 1] = pad + "} else {";
        genBlockCode(rng, lang, depth + 1, out, ind);
        out.push(pad + "}");
      }
    } else if (r < 0.38) {
      out.push(pad + "// " + sentence(rng).toLowerCase());
    } else {
      out.push(pad + cStyleStatement(rng, lang));
    }
  }
}

function genPythonBlock(rng, depth, out, ind) {
  const n = rng.int(1, depth > 1 ? 3 : 5);
  const pad = ind.repeat(depth);
  for (let i = 0; i < n; i++) {
    const r = rng();
    const v = ident(rng);
    if (depth < 4 && r < 0.3) {
      out.push(pad + rng.pick([`for i in range(${rng.int(1, 10)}, ${v}):`, `while ${v} > ${rng.int(0, 5)}:`, `if ${v} % ${rng.int(2, 5)} == 0:`, `for ${v} in ${ident(rng)}:`, `elif ${v} < ${ident(rng)}:`]));
      genPythonBlock(rng, depth + 1, out, ind);
    } else if (r < 0.38) {
      out.push(pad + "# " + sentence(rng).toLowerCase());
    } else {
      out.push(pad + rng.pick([
        `${v} = ${rng.int(0, 100)}`,
        `${v}.append(${ident(rng)})`,
        `print("${sentence(rng)}:", ${v})`,
        `print(f"${sentence(rng)} {${v}}")`,
        `${v} = int(input("${sentence(rng)}: "))`,
        `return ${v}`,
        `${v} += ${ident(rng)}[i]`,
      ]));
    }
  }
}

function genProgram(rng, lang) {
  const ind = rng.pick(["    ", "  ", "\t"]).replace("\t", "    ");
  const out = [];
  if (lang === "python") {
    if (rng.chance(0.6)) out.push(rng.pick(["import math", "import random", "from collections import deque", "import sys"]), "");
    const nf = rng.int(1, 3);
    for (let f = 0; f < nf; f++) {
      if (rng.chance(0.3)) {
        out.push(`class ${rng.pick(CLASSES)}:`);
        out.push(`${ind}def __init__(self, ${ident(rng)}):`);
        out.push(`${ind}${ind}self.${ident(rng)} = ${ident(rng)}`);
        out.push("");
        out.push(`${ind}def ${rng.pick(VERBS)}(self):`);
        genPythonBlock(rng, 2, out, ind);
      } else {
        out.push(`def ${rng.pick(VERBS)}_${rng.pick(NOUNS)}(${ident(rng)}):`);
        genPythonBlock(rng, 1, out, ind);
      }
      out.push("");
    }
    genPythonBlock(rng, 0, out, ind);
    return out;
  }
  if (lang === "sql") {
    const t = rng.pick(["student", "employee", "orders", "product", "dept"]);
    out.push(`CREATE TABLE ${t} (`);
    const cols = rng.int(3, 6);
    for (let i = 0; i < cols; i++) out.push(`${ind}${ident(rng).toLowerCase()} ${rng.pick(["INT", "VARCHAR(50)", "DATE", "DECIMAL(8,2)"])}${i === 0 ? " PRIMARY KEY" : ""}${i < cols - 1 ? "," : ""}`);
    out.push(");", "");
    for (let i = 0; i < rng.int(2, 6); i++) out.push(`INSERT INTO ${t} VALUES (${i + 1}, '${cap(rng.pick(NOUNS))}', ${rng.int(10, 99)});`);
    out.push("", `SELECT * FROM ${t}`, `WHERE ${ident(rng).toLowerCase()} > ${rng.int(1, 50)}`, `ORDER BY ${ident(rng).toLowerCase()};`);
    return out;
  }
  if (lang === "html") {
    out.push("<!DOCTYPE html>", "<html>", "<head>", `${ind}<title>${sentence(rng)}</title>`, "</head>", "<body>");
    for (let i = 0; i < rng.int(3, 8); i++) {
      const tag = rng.pick(["h2", "p", "div", "ul", "table", "form"]);
      if (tag === "ul" || tag === "table" || tag === "form") {
        out.push(`${ind}<${tag} class="${rng.pick(NOUNS)}">`);
        for (let j = 0; j < rng.int(2, 4); j++) out.push(`${ind}${ind}${tag === "ul" ? `<li>${sentence(rng)}</li>` : tag === "table" ? `<tr><td>${rng.pick(NOUNS)}</td><td>${rng.int(1, 99)}</td></tr>` : `<input type="text" name="${rng.pick(NOUNS)}">`}`);
        out.push(`${ind}</${tag}>`);
      } else out.push(`${ind}<${tag}>${sentence(rng)}</${tag}>`);
    }
    out.push("</body>", "</html>");
    return out;
  }
  // brace languages
  if (lang === "c" || lang === "cpp") {
    out.push("#include <stdio.h>");
    if (lang === "cpp") out.push("#include <iostream>", "using namespace std;");
    if (rng.chance(0.4)) out.push(`#define MAX ${rng.int(5, 100)}`);
    out.push("");
  } else if (lang === "java") {
    out.push("import java.util.*;", "", `public class ${rng.pick(CLASSES)} {`);
  } else if (lang === "php") {
    out.push("<?php");
  }
  const base = lang === "java" ? 1 : 0;
  const nf = rng.int(1, 3);
  for (let f = 0; f < nf; f++) {
    const name = rng.pick(VERBS) + (rng.chance(0.5) ? cap(rng.pick(NOUNS)) : "");
    const sig = {
      c: `${rng.pick(["int", "void", "float"])} ${name}(int ${ident(rng)})`,
      cpp: `${rng.pick(["int", "void", "bool"])} ${name}(int ${ident(rng)})`,
      java: `${rng.pick(["public", "private", "public static"])} ${rng.pick(["void", "int", "boolean"])} ${name}(int ${ident(rng)})`,
      js: rng.chance(0.5) ? `function ${name}(${ident(rng)})` : `const ${name} = (${ident(rng)}) =>`,
      php: `function ${name}($${ident(rng)})`,
    }[lang];
    out.push(ind.repeat(base) + sig + " {");
    genBlockCode(rng, lang, base + 1, out, ind);
    out.push(ind.repeat(base) + "}" + (sig.includes("=>") ? ";" : ""));
    out.push("");
  }
  if (lang === "c" || lang === "cpp") {
    out.push("int main() {");
    genBlockCode(rng, lang, 1, out, ind);
    out.push(`${ind}return 0;`, "}");
  } else if (lang === "java") {
    out.push(`${ind}public static void main(String[] args) {`);
    genBlockCode(rng, lang, 2, out, ind);
    out.push(`${ind}}`, "}");
  } else if (lang === "php") {
    out.push("?>");
  } else {
    genBlockCode(rng, lang, 0, out, ind);
  }
  return out;
}

function codeLines(rng) {
  const lang = rng.pick(Object.keys(LANGS));
  let lines = rng.chance(0.3) && SNIPPETS[lang] ? SNIPPETS[lang].split("\n") : genProgram(rng, lang);
  // Screenshots are often a window onto part of a longer file.
  if (lines.length > 12 && rng.chance(0.4)) {
    const start = rng.int(0, Math.floor(lines.length / 2));
    lines = lines.slice(start, start + rng.int(10, lines.length));
  }
  return { lang, lines };
}

// ---------- procedural program output ----------

function outputBody(rng) {
  const out = [];
  const style = rng.pick(["prompts", "menu", "table", "list", "trace", "sql", "mixed", "matrix"]);
  const n = rng.int(3, 18);
  if (style === "menu") {
    for (let r = 0; r < rng.int(1, 3); r++) {
      out.push(rng.pick(["---- MENU ----", "*** " + sentence(rng, 1, 2).toUpperCase() + " ***", "Menu:"]));
      const opts = rng.int(3, 6);
      for (let i = 1; i <= opts; i++) out.push(`${i}. ${cap(rng.pick(VERBS))}${i === opts ? "" : ""}`);
      out.push(`Enter your choice: ${rng.int(1, opts)}`);
      out.push(`${sentence(rng)} ${rng.int(1, 999)}`);
      if (rng.chance(0.5)) out.push("");
    }
  } else if (style === "table" || style === "sql") {
    const cols = rng.int(2, 5);
    const widths = Array.from({ length: cols }, () => rng.int(4, 14));
    const bar = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
    const row = (cells) => "| " + cells.map((c, i) => String(c).padEnd(widths[i]).slice(0, widths[i])).join(" | ") + " |";
    if (style === "sql" && rng.chance(0.6)) out.push(`mysql> SELECT * FROM ${rng.pick(NOUNS)};`);
    out.push(bar, row(widths.map(() => rng.pick(NOUNS))), bar);
    const rows = rng.int(2, 9);
    for (let i = 0; i < rows; i++) out.push(row(widths.map((_, j) => (j === 0 ? i + 1 : rng.chance(0.5) ? cap(rng.pick(NOUNS)) : rng.int(1, 9999)))));
    out.push(bar);
    if (style === "sql") out.push(`${rows} rows in set (0.0${rng.int(0, 9)} sec)`);
  } else if (style === "trace") {
    out.push(rng.pick([
      `Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index ${rng.int(3, 9)} out of bounds for length ${rng.int(1, 3)}`,
      "Traceback (most recent call last):",
      `${rng.pick(NOUNS)}.c:${rng.int(3, 40)}:${rng.int(2, 20)}: error: expected ';' before '}' token`,
    ]));
    for (let i = 0; i < rng.int(2, 5); i++) out.push(rng.pick([`\tat ${rng.pick(CLASSES)}.${rng.pick(VERBS)}(${rng.pick(CLASSES)}.java:${rng.int(5, 90)})`, `  File "${rng.pick(NOUNS)}.py", line ${rng.int(2, 60)}, in ${rng.pick(VERBS)}`, `    ${ident(rng)} = ${ident(rng)}[${rng.int(0, 9)}]`]));
  } else if (style === "matrix") {
    const r = rng.int(2, 5), c = rng.int(2, 5);
    out.push(`${sentence(rng, 1, 3)}:`);
    for (let i = 0; i < r; i++) out.push(Array.from({ length: c }, () => String(rng.int(0, 99)).padStart(4)).join(" "));
    out.push("", `${sentence(rng, 1, 3)}:`);
    for (let i = 0; i < r; i++) out.push(Array.from({ length: c }, () => String(rng.int(0, 999)).padStart(5)).join(" "));
  } else {
    for (let i = 0; i < n; i++) {
      const k = rng();
      if (k < 0.3) out.push(`Enter ${rng.pick(WORDS)} ${rng.pick(WORDS)}: ${rng.int(1, 500)}`);
      else if (k < 0.5) out.push(`${sentence(rng)}: ${rng.chance(0.5) ? rng.int(0, 99999) : (rng() * 1000).toFixed(2)}`);
      else if (k < 0.65) out.push(`${sentence(rng, 1, 3)}: ` + Array.from({ length: rng.int(3, 10) }, () => rng.int(0, 99)).join(rng.pick([" ", ", ", "  "])));
      else if (k < 0.72) out.push("");
      else if (k < 0.8) out.push(`[${Array.from({ length: rng.int(2, 8) }, () => rng.int(0, 99)).join(", ")}]`);
      else out.push(sentence(rng, 2, 9) + rng.pick(["", ".", "!", "..."]));
    }
  }
  return out;
}

const WIN_USERS = ["Admin", "HP", "Student", "Dell", "LENOVO", "Rahul", "ACER", "user"];

function consoleTranscript(rng, flavor) {
  const user = rng.pick(WIN_USERS);
  const dir = rng.pick(["Desktop", "Documents\\Java", "OneDrive\\Desktop\\DSA", "Downloads", "Desktop\\practicals"]);
  const file = rng.pick(CLASSES);
  const out = [];
  const lines = outputBody(rng);
  if (flavor === "cmd") {
    if (rng.chance(0.4)) out.push("Microsoft Windows [Version 10.0.22631.4169]", "(c) Microsoft Corporation. All rights reserved.", "");
    const p = `C:\\Users\\${user}\\${dir}>`;
    const cmds = rng.pick([[`javac ${file}.java`, `java ${file}`], [`gcc ${file.toLowerCase()}.c -o ${file.toLowerCase()}`, `${file.toLowerCase()}.exe`], [`python ${file.toLowerCase()}.py`], [`g++ main.cpp`, "a.exe"], [`node ${file.toLowerCase()}.js`]]);
    for (const c of cmds) out.push(p + c);
    out.push(...lines, "", p);
  } else if (flavor === "powershell") {
    const p = `PS C:\\Users\\${user}\\${dir}> `;
    if (rng.chance(0.4)) out.push("Windows PowerShell", "Copyright (C) Microsoft Corporation. All rights reserved.", "");
    out.push(p + rng.pick([`python .\\${file.toLowerCase()}.py`, `java ${file}`, `node .\\${file.toLowerCase()}.js`, `& "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe" ${file}`]));
    out.push(...lines, p);
  } else if (flavor === "bash") {
    const host = rng.pick(["ubuntu", "kali", "lab-pc", "student-VirtualBox"]);
    const p = `${rng.pick(["student", "user", "root", "kali"])}@${host}:~/${rng.pick(["practicals", "os", "dsa", "Desktop"])}$ `;
    out.push(p + rng.pick([`gcc ${rng.pick(NOUNS)}.c && ./a.out`, `python3 ${rng.pick(NOUNS)}.py`, `sh ${rng.pick(NOUNS)}.sh`, `ls -l`, `./${rng.pick(NOUNS)}`]));
    if (rng.chance(0.3)) for (let i = 0; i < rng.int(2, 6); i++) out.push(`-rw-r--r-- 1 student student ${String(rng.int(100, 9999)).padStart(5)} Sep ${rng.int(1, 30)} 10:${rng.int(10, 59)} ${rng.pick(NOUNS)}.${rng.pick(["c", "py", "txt", "sh"])}`);
    out.push(...lines, p);
  } else if (flavor === "ide") {
    out.push(rng.pick([
      `"C:\\Program Files\\Java\\jdk-21\\bin\\java.exe" "-javaagent:C:\\Program Files\\JetBrains\\IntelliJ IDEA\\lib\\idea_rt.jar" -Dfile.encoding=UTF-8 ${file}`,
      `C:\\Users\\${user}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe C:\\Users\\${user}\\${dir}\\${file.toLowerCase()}.py`,
      `[Running] node "c:\\Users\\${user}\\${dir}\\${file.toLowerCase()}.js"`,
      "",
    ]));
    out.push(...lines, "");
    out.push(rng.pick(["Process finished with exit code 0", "[Done] exited with code=0 in 0.162 seconds", "BUILD SUCCESSFUL (total time: 1 second)", "--------------------------------", `Process exited after ${(rng() * 20).toFixed(3)} seconds with return value 0`, "Press any key to continue . . ."]));
  } else if (flavor === "idle") {
    out.push(`Python 3.12.${rng.int(0, 6)} (tags/v3.12.4:8e8a4ba, Jun  6 2024, 19:30:16) [MSC v.1940 64 bit (AMD64)] on win32`, 'Type "help", "copyright", "credits" or "license()" for more information.', "");
    out.push(`= RESTART: C:\\Users\\${user}\\${dir}\\${file.toLowerCase()}.py`);
    out.push(...lines, ">>> ");
  } else {
    out.push(...lines);
  }
  return out;
}

module.exports = { LANGS, makeRng, codeLines, consoleTranscript, outputBody, sentence, NOUNS, VERBS, CLASSES, WORDS, cap };
