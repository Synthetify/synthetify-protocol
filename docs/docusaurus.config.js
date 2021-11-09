/** @type {import('@docusaurus/types').DocusaurusConfig} */
module.exports = {
  title: 'Synthetify docs',
  tagline: 'Decentralized protocol for synthetic assets, built on Solana',
  url: 'https://synthetify.io/',
  baseUrl: '/',
  onBrokenLinks: 'ignore',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'Synthetify',
  projectName: 'Synthetify docs',
  themeConfig: {
    navbar: {
      title: 'Synthetify',
      logo: {
        alt: 'Synthetify Logo',
        src: 'img/logo.png'
      },
      items: [
        {
          to: 'docs/',
          activeBasePath: 'docs',
          label: 'Docs',
          position: 'left'
        },
        {
          to: '/user-guide/',
          activeBasePath: 'user-guide',
          label: 'User Guide',
          position: 'left'
        },
        {
          href: 'https://twitter.com/synthetify?lang=en',
          label: 'Twitter',
          position: 'right'
        },
        {
          href: 'https://discord.gg/Z9v9ez8u',
          label: 'Discord',
          position: 'right'
        },
        {
          href: 'https://github.com/Synthetify',
          label: 'GitHub',
          position: 'right'
        }
      ]
    },
    algolia: {
      apiKey: 'cca60965bfece8516a34d697fbade50a',
      indexName: 'docs',
      appId: 'PT243LHPBF',
      rateLimit: 5
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'home',
              to: 'docs/'
            }
          ]
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.com/invite/EDrf437'
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/synthetify'
            }
          ]
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/Synthetify'
            }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Synthetify | Built with Docusaurus.`
    }
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://synthetify.io/'
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css')
        }
      }
    ]
  ]
}
