/** @type {import('@docusaurus/types').DocusaurusConfig} */
module.exports = {
  title: 'Synthetify docs',
  tagline: 'Decentralized protocol for synthetic assets, built on Solana',
  url: 'https://synthetify.io/',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'Synthetify',
  projectName: 'Synthetify docs',
  themeConfig: {
    navbar: {
      title: 'Synthetify',
      logo: {
        alt: 'Synthetify Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          to: 'docs/',
          activeBasePath: 'docs',
          label: 'Docs',
          position: 'left',
        },
        {
          href: 'https://github.com/Synthetify',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: 'docs/',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.com/invite/EDrf437',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/synthetify',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/Synthetify',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Synthetify | Built with Docusaurus.`,
    },
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://synthetify.io/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
};
