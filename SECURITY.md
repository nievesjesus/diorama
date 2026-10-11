# Security

## Reporting a vulnerability

Please report security issues through GitHub's private vulnerability reporting for this repository: open the **Security** tab and choose **Report a vulnerability**. That opens a private GitHub Security Advisory, visible only to the maintainers. Do not open a public issue for a security problem.

Include what you did, what happened, and the smallest input that reproduces it. You can expect an acknowledgement within a few days and an update once the issue is triaged.

## Scope and design

Diorama is an Agent Skill that runs entirely on your machine:

- It runs locally and makes no network requests. The kit and scripts import only `node:` builtins.
- It reads input files you point it at and writes standalone HTML and images. It does not send that content anywhere.
- It uses no API keys, tokens or credentials, and expects none to be configured.

The main things worth reporting are anything that reads or writes outside the paths you asked for, escapes the scene input into generated HTML or SVG, or causes a build or capture step to reach the network.
