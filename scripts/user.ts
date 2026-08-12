/* ────────────────────────────────────────────────────────────────
   Account admin, from the machine that holds the database.

   The one path that genuinely needs this is the migration: a journal
   written before accounts existed is adopted by a user whose password
   hash is empty, which no login will ever satisfy. Setting a password
   here is how you get back into your own history.

   Usage:
     npm run user -- list
     npm run user -- passwd <handle> <password>
     npm run user -- add <handle> "<display name>" <password>
     npm run user -- rename <handle> "<new display name>"

   DB_PATH selects the database, as everywhere else.
   ──────────────────────────────────────────────────────────────── */

import {
  createUser, findUserByHandle, listUsers, openDb, setPasswordHash,
} from "../server/db.ts";
import { hashPassword, handleProblem, passwordProblem } from "../server/auth.ts";
import { refreshScores } from "../server/scores.ts";

const DB_PATH = process.env.DB_PATH ?? "./data/zapis.db";
const [command, ...args] = process.argv.slice(2);

const db = openDb(DB_PATH);

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

switch (command) {
  case "list": {
    const users = listUsers(db);
    if (users.length === 0) {
      console.log("no accounts yet");
      break;
    }
    for (const u of users) {
      const locked = findUserByHandle(db, u.handle)!.passwordHash === "";
      console.log(
        `${String(u.id).padStart(3)}  ${u.handle.padEnd(20)} ${u.display.padEnd(24)}` +
          `${locked ? "  [locked — set a password]" : ""}` +
          `${u.shareScores ? "" : "  [hidden from board]"}`,
      );
    }
    break;
  }

  case "passwd": {
    const [handle, password] = args;
    if (!handle || !password) die("usage: npm run user -- passwd <handle> <password>");

    const bad = passwordProblem(password);
    if (bad) die(bad);

    const user = findUserByHandle(db, handle);
    if (!user) die(`no account with handle '${handle}'`);

    setPasswordHash(db, user.id, await hashPassword(password));
    console.log(`password set for ${user.handle}`);
    break;
  }

  case "add": {
    const [handle, display, password] = args;
    if (!handle || !display || !password) {
      die('usage: npm run user -- add <handle> "<display name>" <password>');
    }

    const bad = handleProblem(handle) ?? passwordProblem(password);
    if (bad) die(bad);
    if (findUserByHandle(db, handle)) die(`handle '${handle}' is taken`);

    const user = createUser(db, {
      handle, display, passwordHash: await hashPassword(password),
    });
    refreshScores(db, user.id);
    console.log(`created ${user.handle} (id ${user.id})`);
    break;
  }

  case "rename": {
    const [handle, display] = args;
    if (!handle || !display) {
      die('usage: npm run user -- rename <handle> "<new display name>"');
    }

    const user = findUserByHandle(db, handle);
    if (!user) die(`no account with handle '${handle}'`);

    db.prepare(`UPDATE users SET display = ? WHERE id = ?`).run(display.trim(), user.id);
    console.log(`${user.handle} now displays as '${display.trim()}'`);
    break;
  }

  default:
    die(
      "usage:\n" +
        "  npm run user -- list\n" +
        "  npm run user -- passwd <handle> <password>\n" +
        '  npm run user -- add <handle> "<display name>" <password>\n' +
        '  npm run user -- rename <handle> "<new display name>"',
    );
}
