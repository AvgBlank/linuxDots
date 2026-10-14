local M = {}

local function in_herdr()
  return vim.env.HERDR_ENV == '1'
end

local function run(argv)
  local output = vim.fn.system(argv)
  if vim.v.shell_error ~= 0 then
    vim.notify(output, vim.log.levels.ERROR)
  end
end

function M.navigate(direction)
  local window = vim.api.nvim_get_current_win()
  vim.cmd('wincmd ' .. direction)
  if window == vim.api.nvim_get_current_win() and direction ~= 'p' then
    local directions = { h = 'left', j = 'down', k = 'up', l = 'right' }
    run({ 'herdr', 'pane', 'focus', '--current', '--direction', directions[direction] })
  end
end

function M.setup()
  if not in_herdr() then
    return
  end
  for _, direction in ipairs({ 'h', 'j', 'k', 'l', 'p' }) do
    local key = direction == 'p' and '<C-\\>' or '<C-' .. direction .. '>'
    vim.keymap.set('n', key, function() M.navigate(direction) end,
      { desc = 'Navigate Neovim splits and Herdr panes' })
  end
end

return M
