-- Setup Lazy Nvim
local lazypath = vim.fn.stdpath 'data' .. '/lazy/lazy.nvim'
if not (vim.uv or vim.loop).fs_stat(lazypath) then
    local lazyrepo = 'https://github.com/folke/lazy.nvim.git'
    local out = vim.fn.system { 'git', 'clone', '--filter=blob:none', '--branch=stable', lazyrepo, lazypath }
    if vim.v.shell_error ~= 0 then
        vim.api.nvim_echo({
            { 'Failed to clone lazy.nvim:\n', 'ErrorMsg' },
            { out,                            'WarningMsg' },
            { '\nPress any key to exit...' },
        }, true, {})
        vim.fn.getchar()
        os.exit(1)
    end
end
vim.opt.rtp:prepend(lazypath)

-- Plugins
require('lazy').setup {
    spec = {
        -- { 'm4xshen/autoclose.nvim' },
        { 'tpope/vim-commentary' },
        { 'tpope/vim-surround' },
        { 'mbbill/undotree' },
        { 'lukas-reineke/indent-blankline.nvim' },
        { 'CRAG666/code_runner.nvim' },
        { 'tpope/vim-fugitive' },
        { 'stevearc/conform.nvim' },
        { 'windwp/nvim-ts-autotag' },
        { 'williamboman/mason.nvim' },
        { 'williamboman/mason-lspconfig.nvim' },
        { 'VonHeikemen/lsp-zero.nvim',          branch = 'v3.x' },
        { 'neovim/nvim-lspconfig' },
        { 'hrsh7th/cmp-nvim-lsp' },
        { 'hrsh7th/nvim-cmp' },
        { 'L3MON4D3/LuaSnip' },
        {
            'nvim-neo-tree/neo-tree.nvim',
            branch = 'v3.x',
            dependencies = {
                'nvim-lua/plenary.nvim',
                'nvim-tree/nvim-web-devicons', -- not strictly required, but recommended
                'MunifTanjim/nui.nvim',
                '3rd/image.nvim',              -- Optional image support in preview window: See `# Preview Mode` for more information
            },
        },
        {
            'windwp/nvim-autopairs',
            event = 'InsertEnter',
            config = true,
        },
        {
            'rcarriga/nvim-dap-ui',
            dependencies = {
                'nvim-neotest/nvim-nio',
                'mfussenegger/nvim-dap',
                'theHamsta/nvim-dap-virtual-text',
            },
        },
        {
            'nvim-telescope/telescope-fzf-native.nvim',
            build = 'make',
        },
        {
            'rose-pine/neovim',
            name = 'rose-pine',
        },
        {
            'nvim-treesitter/nvim-treesitter',
            build = ':TSUpdate',
        },
        {
            'nvim-telescope/telescope.nvim',
            tag = '0.1.8',
            dependencies = { 'nvim-lua/plenary.nvim' },
        },
        {
            'nvim-lualine/lualine.nvim',
            dependencies = { 'nvim-tree/nvim-web-devicons' },
        },
        {
            'folke/todo-comments.nvim',
            dependencies = { 'nvim-lua/plenary.nvim' },
            opts = {},
        },
    },
    install = { colorscheme = { 'rose-pine' } },
    checker = { enabled = true, notify = false },
}
