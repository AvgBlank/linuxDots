#!/bin/sh
set -eu

# Restore plugins from their current default branches, without commit pins.
herdr plugin install devswha/herdr-web-ui --yes
herdr plugin install speardragon/herdr-plugin-manager --yes
