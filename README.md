## vcmp-updater
NodeJS script to host a VC:MP client updater. Source used for http://v4.vcmp.net/updater.

<img src="https://i.imgur.com/5T2tjtq.png" alt="updater" width=400>

### Installation
- Clone the repository.
- Run `npm i` into the directory.

### Configuration
The `config.json` file contains:
- **port:** The port to listen at.
- **password:** Updater password, if its set, requests will need to provide it.
- **updater:** Updater URL to fetch updates from. Leave blank to disable.
- **logging:** Enable/disable logging.