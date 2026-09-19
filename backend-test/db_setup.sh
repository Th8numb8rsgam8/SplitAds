sudo apt update
sudo apt install -y curl git build-essential

# Download and run the NVM installation script
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

source ~/.bashrc

# Install the latest Long Term Support (LTS) release
nvm install --lts

# Verify installation
node -v
npm -v

sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
# Access the PostgreSQL interactive prompt as the 'postgres' user
sudo -u postgres psql

# -- Create a secure password for the admin postgres user
ALTER USER postgres WITH PASSWORD 'mysecretpassword';

# -- Create your application's database
CREATE DATABASE split_ads_db;

mkdir backend-test && cd backend-test
npm init -y
npm install express pg dotenv