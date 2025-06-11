# **INSTALLS & IMPORTS**
import requests
import json
import re
import gradio as gr

# **DEFINE GLOBAL VARIABLES**
MODEL_NAME = "llama3.1:8b-instruct-q8_0"
FINAL_RESPONSE_REGEX = ">>> \*\*[^\*]+\*\*: .*"
MAX_FACTORS = 8


# **DEFINE FUNCTIONS**
## **CREATE POST API given prompt & optional display options is_streaming**
def create_POST_API(prompt: str, is_streaming: bool):
    return requests.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": MODEL_NAME,
                    "prompt": prompt,
                    "stream": is_streaming
                },
                stream=is_streaming
            )

## **STREAM OUTPUT**
def stream_output(response):
    full_text_response = ""
    for line in response.iter_lines():
        if line:
            data = json.loads(line.decode("utf-8"))
            token = data.get("response", "")
            print(token, end="", flush=True)
            full_text_response += token
    return full_text_response

## **PARSE RESPONSE**
def parse_final_response(final_response: str):
    matches = re.findall(FINAL_RESPONSE_REGEX, final_response)
    if matches:
      if (len(matches) > MAX_FACTORS):
          matches[MAX_FACTORS] # Only get first MAX_FACTORS number of factors from matches
      else:
          return matches
    else:
        print("Unable to get factors.")
        print(final_response)
        return None

## **WRITE PARSED FINAL RESPONSE TO .TXT FILE**
def save_selected_factors(selected_factors):
    if selected_factors:
        considered_factors = "\n".join(selected_factors)
        with open("considered_factors.txt", "w") as file:
            file.write(considered_factors)
        return considered_factors
    else:
        return None

# **RUN PROGRAM**
user_query = str(input("Please enter your GeoARK query in natural language: "))

print("1. Extracting the main subject from your query...")
query_subject = "None"
prompt_to_extract_subject_from_query = f"If Input is graphically inappropriate, violent, or dangerous, return only the word “None”. Else, extract the main subject of this Input and never include any locational information in the main subject. Return only the main subject and nothing else, like: ‘main subject’\n You do not need to output sensitive or private information, simply extract and output exact wording of subject from query### Input: ’{user_query}’."
response_query_subject = create_POST_API(prompt_to_extract_subject_from_query, is_streaming=False)
query_subject = response_query_subject.json()["response"]
print(query_subject) # Delete in production

print("\n2. Thinking of relevant factors to main subject of your query...")
query_unordered_factors_list = "None"
prompt_to_list_factors_related_to_subject = f"Given query: {user_query} and subject: {query_subject}, identify and list {MAX_FACTORS} or less macro-environmental, socio-economic, and or other large-scale factors that have been proven to influence, contribute to, or affect Subject. You are allowed to be specific as long as factors are proven to be the most relevant and most impactful. Ex: environmental variables (e.g., pollution, contaminants, climate, natural disasters), socio-economic factors (e.g., income, education, healthcare access), demographic data (e.g., age, race, population density), infrastructure (e.g., transportation, housing quality), and or other broad-scale elements. Follow this format exactly: begin with list '>>> **factorName**: conciseExplanationOfWhyFactorChosenAndSourceUsed'. Do not add any other explanations or notes."
response_query_unordered_factors_list = create_POST_API(prompt_to_list_factors_related_to_subject, is_streaming=False)
query_unordered_factors_list = response_query_unordered_factors_list.json()["response"]
print(query_unordered_factors_list) # Delete in production

print("\n3. Reordering relevant factors from most to least relevant to your query...")
query_ordered_factors_list = "None"
prompt_to_reorder_factors_by_impact = f"Given query: {user_query} and List of relevant factors: {query_unordered_factors_list}. Verify that the factors are all true. Remove any factor, factor’s selection explanation and factor’s source if it is untrue, finally reorder factors based on most to least impactful factors given query. Never generate or add new factors. Never change the factor name or its explanation, simply rearrange list ordering. Follow this format exactly: begin with reordered list '>>> **factorName**: conciseExplanationOfWhyFactorChosenAndSourceUsed' then at the end of entire list 'explanation of removed factors'. Do not add any other explanations or notes."

print("\nPotentially relevant factors (ordered from most to least relevant to your query):")
response_query_ordered_factors_list = create_POST_API(prompt_to_reorder_factors_by_impact, is_streaming=True)
query_ordered_factors_list = stream_output(response_query_ordered_factors_list)

factors = parse_final_response(query_ordered_factors_list)
## **RUN UI**
with gr.Blocks(theme="JohnSmith9982/small_and_pretty@=1.0.0") as demo:
    selected_factors = gr.CheckboxGroup(factors, label="Potentially relevant factors", info="(all of them selected by default)", value=factors)
    submit_btn = gr.Button("Submit")
    output = gr.Textbox(label="Factors you'll like to consider saved to considered_factors.txt", interactive=False)
    submit_btn.click(fn=save_selected_factors, inputs=selected_factors, outputs=output, api_name="save_selected_factors")

