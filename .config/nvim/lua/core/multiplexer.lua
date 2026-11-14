local M = {}

-- The Herdr TUI sets HERDR_ENV. The Herdr app runs its terminals in herdr-core, which sets HC_TERMINAL_ID instead.
local function in_herdr()
  return vim.env.HERDR_ENV == '1'
end

local function in_herdr_app()
  return not in_herdr() and vim.env.HC_TERMINAL_ID ~= nil
end

function M.active()
  return in_herdr() or in_herdr_app()
end

local function run(argv)
  local output = vim.fn.system(argv)
  if vim.v.shell_error ~= 0 then
    vim.notify(output, vim.log.levels.ERROR)
  end
end

local function herdr_app()
  local path = vim.fn.exepath('herdr-app')
  return path ~= '' and path or vim.fn.expand('~/.local/bin/herdr-app')
end

function M.navigate(direction)
  local window = vim.api.nvim_get_current_win()
  vim.cmd('wincmd ' .. direction)
  if window == vim.api.nvim_get_current_win() and direction ~= 'p' then
    local directions = { h = 'left', j = 'down', k = 'up', l = 'right' }
    if in_herdr() then
      run({ 'herdr', 'pane', 'focus', '--current', '--direction', directions[direction] })
    else
      -- Async, so the key never waits on the app; a failure (or no herdr-app at all) is reported, not raised.
      local ok, err = pcall(vim.system, { herdr_app(), 'do', 'pane.go', vim.json.encode({ direction = directions[direction] }) },
        { text = true }, function(r)
          if r.code ~= 0 then
            vim.schedule(function() vim.notify('herdr-app pane.go: ' .. vim.trim(r.stderr ~= '' and r.stderr or r.stdout), vim.log.levels.ERROR) end)
          end
        end)
      if not ok then vim.notify('herdr-app: ' .. tostring(err), vim.log.levels.ERROR) end
    end
  end
end

function M.setup()
  if not M.active() then
    return
  end
  for _, direction in ipairs({ 'h', 'j', 'k', 'l', 'p' }) do
    local key = direction == 'p' and '<C-\\>' or '<C-' .. direction .. '>'
    vim.keymap.set('n', key, function() M.navigate(direction) end,
      { desc = 'Navigate Neovim splits and Herdr panes' })
  end
end

return M
