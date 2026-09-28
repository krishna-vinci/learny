import { hashPassword } from "./password.js";

process.stdin.setEncoding("utf8");

let password = "";
for await (const chunk of process.stdin) {
  password += chunk;
}

password = password.replace(/\r?\n$/, "");
console.log(await hashPassword(password));
