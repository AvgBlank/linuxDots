-- Vim Settings
vim.opt.nu = true
vim.opt.relativenumber = true
vim.opt.cursorline = true

vim.opt.tabstop = 4
vim.opt.softtabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true
vim.opt.wrap = false

vim.opt.smartindent = true

vim.opt.hlsearch = false
vim.opt.incsearch = true
vim.opt.ignorecase = true
vim.opt.smartcase = true

vim.opt.swapfile = false
vim.opt.backup = false
vim.opt.undodir = os.getenv 'HOME' .. '/.vim/undodir'
vim.opt.undofile = true

vim.opt.termguicolors = true

vim.opt.showmode = false

vim.opt.scrolloff = 10

-- Netrw
vim.g.netrw_keepdir = 0
vim.g.netrw_localcopydircmd = 'cp -r'

-- Highlight when yanking
vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('kickstart-highlight-yank', { clear = true }),
  callback = function()
    vim.highlight.on_yank()
  end,
})

-- Set up Indenting
-- Set indentation to 2 spaces for specific file types (C, C++, HTML, JS, CSS, etc.)
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'lua', 'c', 'cpp', 'html', 'javascript', 'javascriptreact', 'css', 'typescript', 'typescriptreact', 'json' },
  callback = function()
    vim.opt_local.tabstop = 2
    vim.opt_local.softtabstop = 2
    vim.opt_local.shiftwidth = 2
  end,
})

-- Restore default indentation (4 spaces) for everything else
vim.api.nvim_create_autocmd('FileType', {
  pattern = '*', -- Matches all file types
  callback = function()
    -- If the filetype is NOT one of the specified ones, set to 4 spaces
    local excluded_filetypes = { 'lua', 'c', 'cpp', 'html', 'javascript', 'javascriptreact', 'css', 'typescript', 'typescriptreact', 'json' }
    if not vim.tbl_contains(excluded_filetypes, vim.bo.filetype) then
      vim.opt_local.tabstop = 4
      vim.opt_local.softtabstop = 4
      vim.opt_local.shiftwidth = 4
    end
  end,
})
