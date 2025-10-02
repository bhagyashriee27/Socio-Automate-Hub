
import mysql.connector
import pandas as pd
import os
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

TABLES_TO_EXPORT = ["instagram", "user", "telegram", "facebook"]
EXCEL_FILE_NAME = "database_export.xlsx"

def export_data_to_excel():
    conn = None
    try:
        print("Attempting to connect to the database...")
        conn = mysql.connector.connect(**DB_CONFIG)
        if conn.is_connected():
            print("Successfully connected to the database.")
            cursor = conn.cursor()

            # Create a Pandas Excel writer using XlsxWriter as the engine.
            # The Excel file will be created in the same directory as the script.
            script_dir = os.path.dirname(os.path.abspath(__file__))
            excel_path = os.path.join(script_dir, EXCEL_FILE_NAME)
            
            with pd.ExcelWriter(excel_path, engine='xlsxwriter') as writer:
                for table_name in TABLES_TO_EXPORT:
                    print(f"Fetching data from table: {table_name}...")
                    query = f"SELECT * FROM {table_name}"
                    cursor.execute(query)
                    
                    # Fetch all rows and column names
                    columns = [col[0] for col in cursor.description]
                    data = cursor.fetchall()
                    
                    # Create a DataFrame and write to a sheet
                    df = pd.DataFrame(data, columns=columns)
                    df.to_excel(writer, sheet_name=table_name, index=False)
                    print(f"Data from {table_name} written to sheet '{table_name}'.")
            
            print(f"\nData successfully exported to {excel_path}")

        else:
            print("Failed to connect to the database.")

    except mysql.connector.Error as e:
        print(f"Database error: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        if conn and conn.is_connected():
            conn.close()
            print("Database connection closed.")
            
            

if __name__ == "__main__":
    export_data_to_excel()


