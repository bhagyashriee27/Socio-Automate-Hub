import os
import re
import json
from time import sleep
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import mysql.connector
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database configuration from environment variables
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}

SCOPES = ["https://www.googleapis.com/auth/drive"]
REFRESH_INTERVAL_SECONDS = 3600  # 1 hour

# --- Database Functions ---
def get_db_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def get_all_accounts():
    conn = get_db_connection()
    if not conn:
        return []
    cursor = conn.cursor(dictionary=True)
    query = """
        SELECT id, username, token_drive, google_drive_link
        FROM instagram
        WHERE done = 'No' AND posts_left > 0
    """
    cursor.execute(query)
    accounts = cursor.fetchall()
    cursor.close()
    conn.close()
    return accounts

def update_drive_token(account_id, token_json):
    conn = get_db_connection()
    if not conn:
        return
    cursor = conn.cursor()
    cursor.execute("UPDATE instagram SET token_drive = %s WHERE id = %s", (token_json, account_id))
    conn.commit()
    cursor.close()
    conn.close()
    print(f"Updated token_drive for account ID {account_id}")

def get_valid_token_from_other_account(current_account_id):
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor(dictionary=True)
    query = """
        SELECT token_drive
        FROM instagram
        WHERE id != %s AND token_drive IS NOT NULL AND token_drive != '' AND token_drive != '{}'
        LIMIT 1
    """
    cursor.execute(query, (current_account_id,))
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    if result:
        print(f"Found token_drive from another account.")
        return result['token_drive']
    print("No valid token_drive found in other accounts.")
    return None

# --- Google Drive Functions ---
def validate_credentials(creds):
    if not creds:
        return False
    drive_service = build('drive', 'v3', credentials=creds)
    try:
        # Test by listing files in root (minimal operation)
        drive_service.files().list(pageSize=1, fields="files(id)").execute()
        print("Credentials are valid.")
        return True
    except Exception as e:
        print(f"Credentials validation failed: {str(e)}")
        return False

def get_or_refresh_credentials(account, max_retries=3):
    account_id = account['id']
    username = account['username']
    creds = None

    # Load from database if exists
    if account['token_drive']:
        try:
            token_str = account['token_drive'].strip('"').replace('\\"', '"').replace("\\'", "'")
            token_data = json.loads(token_str)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            print(f"Loaded token_drive from database for {username}")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"ERROR: Invalid token_drive for {username}: {str(e)}. Treating as null.")
            creds = None

    refreshed = False
    if creds:
        if creds.expired and creds.refresh_token:
            for attempt in range(max_retries):
                try:
                    creds.refresh(Request())
                    print(f"Refreshed token for {username}")
                    update_drive_token(account_id, creds.to_json())
                    refreshed = True
                    break
                except Exception as e:
                    print(f"Refresh attempt {attempt + 1}/{max_retries} failed for {username}: {str(e)}")
                    if attempt < max_retries - 1:
                        sleep(5)
                    else:
                        print(f"Max retries reached for {username}. Attempting alternative methods.")
                        creds = None

    # If still no creds, try copying from another account
    if not creds:
        other_token = get_valid_token_from_other_account(account_id)
        if other_token:
            try:
                token_str = other_token.strip('"').replace('\\"', '"').replace("\\'", "'")
                token_data = json.loads(token_str)
                creds = Credentials.from_authorized_user_info(token_data, SCOPES)
                # Validate if it works
                if validate_credentials(creds):
                    # If expired, try refresh
                    if creds.expired and creds.refresh_token:
                        try:
                            creds.refresh(Request())
                            print(f"Refreshed copied token for {username}")
                        except Exception as e:
                            print(f"Failed to refresh copied token: {str(e)}. Discarding.")
                            creds = None
                    if creds:
                        update_drive_token(account_id, creds.to_json())
                        refreshed = True
                        print(f"Successfully used and saved token from another account for {username}")
                else:
                    print(f"Copied token does not work. Discarding.")
                    creds = None
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                print(f"ERROR: Invalid copied token_drive: {str(e)}. Skipping.")
                creds = None

    # If still no creds, attempt new authentication (requires interaction)
    if not creds:
        if not os.path.exists('credentials.json'):
            print(f"ERROR: credentials.json not found for {username}. Skipping token creation.")
            return None
        try:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
            update_drive_token(account_id, creds.to_json())
            print(f"Obtained and saved new token for {username}")
            refreshed = True
        except Exception as e:
            print(f"ERROR: Failed to obtain new token for {username}: {str(e)}. May require manual intervention.")
            return None

    return creds, refreshed

# --- Main Execution ---
def main():
    print("--- Token Refresh Scheduler ---")
    while True:
        accounts = get_all_accounts()
        if not accounts:
            print("No active accounts found. Sleeping...")
        else:
            for account in accounts:
                print(f"\nProcessing account: {account['username']} (ID: {account['id']})")
                
                # Handle token refresh or creation
                creds, was_refreshed = get_or_refresh_credentials(account)
                if not creds:
                    print(f"Skipping {account['username']} due to token issues.")
                    continue
                
                print(f"Token handled successfully for {account['username']}")

        print(f"\nScheduler run complete. Sleeping for {REFRESH_INTERVAL_SECONDS / 3600} hours...\n")
        sleep(REFRESH_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
    
    
    



