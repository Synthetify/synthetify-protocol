module.exports = {
  docs: [
    'home',
    'whats-new',
    'faq',
    {
      type: 'category',
      label: 'Protocol',
      collapsed: true,
      items: ['overview', 'solana', 'synthetify-token', 'synthetic-tokens', 'glossary']
    },
    {
      type: 'category',
      label: 'User Guide',
      collapsed: true,
      items: ['connect-to-wallet', 'faucet', 'staking', 'exchange']
    },
    'architecture-overview',
    {
      type: 'category',
      label: 'Technical side',
      collapsed: true,
      items: [
        'technical/overview',
        'technical/account',
        'technical/state',
        'technical/collateral',
        'technical/synthetics',
        'technical/staking',
        'technical/vaults',
        'technical/swapline'
      ]
    }
  ]
}
