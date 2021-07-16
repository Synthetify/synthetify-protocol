module.exports = {
  docs: [
    'home',
    'whats-new',
    'faq',
       {
      type: 'category',
      label: 'Protocol',
      collapsed: true,
      items: ['overview', 'solana', 'synthetify-token', 'synthetic-tokens', 'platform'] 
    },
    {
      type: 'category',
      label: 'User Guide',
      collapsed: true,
      items: ['connect-to-wallet','faucet','staking', 'exchange']
    },
    'architecture-overview'
  ]
}
