const path = require('path');
const fs = require('fs');
const Datastore = require('nedb-promises');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const users = Datastore.create({ filename: path.join(DATA_DIR, 'users.db'), autoload: true, timestampData: true });
const polls = Datastore.create({ filename: path.join(DATA_DIR, 'polls.db'), autoload: true, timestampData: true });
const votes = Datastore.create({ filename: path.join(DATA_DIR, 'votes.db'), autoload: true, timestampData: true });
const captcha = Datastore.create({ filename: path.join(DATA_DIR, 'captcha.db'), autoload: true, timestampData: true });

users.ensureIndex({ fieldName: 'username', unique: true });
users.ensureIndex({ fieldName: 'email', unique: true, sparse: true });
polls.ensureIndex({ fieldName: 'status' });
votes.ensureIndex({ fieldName: 'poll_id' });
votes.ensureIndex({ fieldName: 'user_id' });
votes.ensureIndex({ fieldName: 'ip_hash' });
captcha.ensureIndex({ fieldName: 'id', unique: true });

module.exports = { users, polls, votes, captcha };
