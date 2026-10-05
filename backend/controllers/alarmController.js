const alarmService = require('../services/alarms/alarmService');

const id = (req) => Number(req.params.id);

const list = async (req, res) => res.json({ alarms: await alarmService.list(req.user.id) });
const get = async (req, res) => res.json({ alarm: await alarmService.get(req.user.id, id(req)) });
const create = async (req, res) => res.status(201).json({ alarm: await alarmService.create(req.user.id, req.body) });
const update = async (req, res) => res.json({ alarm: await alarmService.update(req.user.id, id(req), req.body) });
const enable = async (req, res) => res.json({ alarm: await alarmService.setEnabled(req.user.id, id(req), true) });
const disable = async (req, res) => res.json({ alarm: await alarmService.setEnabled(req.user.id, id(req), false) });
const test = async (req, res) => res.json({ notification: await alarmService.test(req.user.id, id(req)) });
const snooze = async (req, res) => res.json(await alarmService.snooze(req.user.id, id(req), req.body?.minutes));

async function remove(req, res) {
  await alarmService.remove(req.user.id, id(req));
  res.json({ ok: true });
}

module.exports = { list, get, create, update, enable, disable, test, snooze, remove };
