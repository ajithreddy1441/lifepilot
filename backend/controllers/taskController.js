const taskService = require('../services/tasks/taskService');
const recurringService = require('../services/tasks/recurringService');

const list = async (req, res) => res.json({ tasks: await taskService.list(req.user.id, req.query) });

async function create(req, res) {
  const { repeat, ...data } = req.body;
  const task = await taskService.create(req.user.id, data);
  if (repeat && task.start_at) await recurringService.createFromTask(req.user.id, task, repeat, req.user.timezone);
  res.status(201).json({ task });
}

const get = async (req, res) => res.json({ task: await taskService.get(req.user.id, Number(req.params.id)) });
const update = async (req, res) => res.json({ task: await taskService.update(req.user.id, Number(req.params.id), req.body) });
const complete = async (req, res) => res.json({ task: await taskService.complete(req.user.id, Number(req.params.id)) });
const reschedule = async (req, res) => res.json({ task: await taskService.reschedule(req.user.id, Number(req.params.id), req.body) });

async function remove(req, res) {
  await taskService.remove(req.user.id, Number(req.params.id));
  res.json({ ok: true });
}

module.exports = { list, create, get, update, complete, reschedule, remove };
