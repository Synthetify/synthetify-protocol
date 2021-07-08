module.exports = {
  docs: [
    'home',
    'whats-new',
    'faq',
       {
      type: 'category',
      label: 'Protocol',
      collapsed: false,
      items: ['overview', 'solana', 'synthetify-token', 'synthetic-tokens']
    },
    {
      type: 'category',
      label: 'User Guide',
      collapsed: false,
      items: ['connect-to-wallet','faucet','staking', 'exchange']
    },
    'architecture-overview'
  ]
}
